import { useEffect, useRef, useState, type ReactNode } from "react";
import { CalendarDays, Play, Download, Trash2, AlertTriangle } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSubjectStore } from "@/stores/subject-store";
import { useTeacherStore } from "@/stores/teacher-store";
import { useClassStore } from "@/stores/class-store";
import { useTimetableStore } from "@/stores/timetable-store";
import { useGradeLevelStore } from "@/stores/grade-level-store";
import { useToast } from "@/hooks/use-toast";
import { generateTimetable } from "@/utils/scheduler";
import { exportTimetableToExcel } from "@/utils/excel-export";
import { WEEKDAYS } from "@/types";
import type { Subject, Timetable, TimetableEntry, Weekday } from "@/types";

function isValidSwap(
  src: TimetableEntry,
  tgt: TimetableEntry,
  allEntries: TimetableEntry[],
  subjects: Subject[],
): boolean {
  const sS = subjects.find((s) => s.id === src.subject_id);
  const sT = subjects.find((s) => s.id === tgt.subject_id);
  if (!sS || !sT) return true;

  const { day: dS, slot: slS } = src;
  const { day: dT, slot: slT } = tgt;

  // Remaining entries at each slot after the swap (the departing entry is gone)
  const atTargetAfter = allEntries.filter((e) => e.day === dT && e.slot === slT && e.id !== tgt.id);
  const atSourceAfter = allEntries.filter((e) => e.day === dS && e.slot === slS && e.id !== src.id);

  // ── Source subject moving to target slot ─────────────────────────────────

  if (sS.allowed_days.length > 0 && !sS.allowed_days.includes(dT)) return false;
  if (sS.allowed_slots.length > 0 && !sS.allowed_slots.includes(slT)) return false;

  // Coupled groups can't be partially moved — one class can't be separated from the others
  if (sS.coupled_class_ids.length > 0) return false;

  // Parallel partner must already be present at the target slot for the same class
  if (sS.parallel_partner_subject_id !== null) {
    const ok = atTargetAfter.some(
      (e) => e.class_id === src.class_id && e.subject_id === sS.parallel_partner_subject_id,
    );
    if (!ok) return false;
  }

  if (sS.no_parallel_classes) {
    // No other class may have the same subject at the target slot
    if (atTargetAfter.some((e) => e.subject_id === sS.id && e.class_id !== src.class_id)) return false;
    // No explicitly listed subject may be at the target slot
    if (sS.no_parallel_subject_ids.some((id) => atTargetAfter.some((e) => e.subject_id === id)))
      return false;
  }

  if (sS.no_double_periods) {
    const othersOnDay = allEntries.filter(
      (e) => e.class_id === src.class_id && e.subject_id === sS.id && e.day === dT && e.id !== src.id,
    );
    if (othersOnDay.some((e) => Math.abs(e.slot - slT) === 1)) return false;
  }

  // ── Target subject moving to source slot ─────────────────────────────────

  if (sT.allowed_days.length > 0 && !sT.allowed_days.includes(dS)) return false;
  if (sT.allowed_slots.length > 0 && !sT.allowed_slots.includes(slS)) return false;

  if (sT.coupled_class_ids.length > 0) return false;

  if (sT.parallel_partner_subject_id !== null) {
    const ok = atSourceAfter.some(
      (e) => e.class_id === tgt.class_id && e.subject_id === sT.parallel_partner_subject_id,
    );
    if (!ok) return false;
  }

  if (sT.no_parallel_classes) {
    if (atSourceAfter.some((e) => e.subject_id === sT.id && e.class_id !== tgt.class_id)) return false;
    if (sT.no_parallel_subject_ids.some((id) => atSourceAfter.some((e) => e.subject_id === id)))
      return false;
  }

  if (sT.no_double_periods) {
    const othersOnDay = allEntries.filter(
      (e) => e.class_id === tgt.class_id && e.subject_id === sT.id && e.day === dS && e.id !== tgt.id,
    );
    if (othersOnDay.some((e) => Math.abs(e.slot - slS) === 1)) return false;
  }

  return true;
}

export function TimetablePage() {
  const { subjects, fetch: fetchSubjects } = useSubjectStore();
  const { teachers, fetch: fetchTeachers } = useTeacherStore();
  const { classes, fetch: fetchClasses } = useClassStore();
  const { timetables, activeTimetable, loading, fetch: fetchTimetables, save: saveTimetable, remove, setActive, swapEntries } = useTimetableStore();
  const { configs: gradeLevelConfigs, fetch: fetchGradeLevelConfigs } = useGradeLevelStore();
  const { toast } = useToast();

  const [generating, setGenerating] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [schoolYear, setSchoolYear] = useState(`${new Date().getFullYear()}/${new Date().getFullYear() + 1}`);
  const [viewMode, setViewMode] = useState<"classes" | "teachers">("classes");
  const [selectedClassName, setSelectedClassName] = useState<string>("all");
  const [selectedTeacherAbbr, setSelectedTeacherAbbr] = useState<string>("all");
  const [dragEntry, setDragEntry] = useState<TimetableEntry | null>(null);
  // Ref so onCellDrop always reads the current entry regardless of closure age
  const dragEntryRef = useRef<TimetableEntry | null>(null);

  useEffect(() => {
    fetchSubjects();
    fetchTeachers();
    fetchClasses();
    fetchTimetables();
    fetchGradeLevelConfigs();
  }, [fetchSubjects, fetchTeachers, fetchClasses, fetchTimetables, fetchGradeLevelConfigs]);

  const handleGenerate = async () => {
    if (teachers.length === 0 || classes.length === 0 || subjects.length === 0) {
      toast({
        variant: "destructive",
        title: "Konfiguration unvollständig",
        description: "Bitte erst Fächer, Lehrkräfte und Klassen anlegen.",
      });
      return;
    }

    setGenerating(true);
    try {
      const result = generateTimetable(teachers, classes, subjects, gradeLevelConfigs);
      setWarnings(result.warnings);

      const now = new Date();
      const date = now.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
      const time = now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
      const name = `Stundenplan ${schoolYear} (erstellt am ${date} ${time})`;

      const id = await saveTimetable(name, schoolYear, result.entries);
      // saveTimetable calls fetch() internally — read from live store state, not the stale closure
      const fresh = useTimetableStore.getState().timetables.find((t) => t.id === id);
      if (fresh) setActive(fresh);

      toast({
        title: "Stundenplan generiert",
        description:
          result.warnings.length > 0
            ? `${result.entries.length} Einträge erstellt, ${result.warnings.length} Warnungen.`
            : `${result.entries.length} Einträge erfolgreich eingeplant.`,
      });
    } catch (err) {
      toast({ variant: "destructive", title: "Fehler", description: String(err) });
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (timetable: Timetable) => {
    if (!confirm(`Stundenplan "${timetable.name}" wirklich löschen?`)) return;
    await remove(timetable.id);
    toast({ title: "Stundenplan gelöscht" });
  };

  const handleExportExcel = async () => {
    if (!activeTimetable) return;
    const destPath = await save({
      defaultPath: `${activeTimetable.name.replace(/\s/g, "_")}.xlsx`,
      filters: [{ name: "Excel", extensions: ["xlsx"] }],
    });
    if (!destPath) return;
    try {
      const buffer = exportTimetableToExcel(activeTimetable, classes, teachers, subjects);
      await invoke("save_file", { path: destPath, data: Array.from(buffer) });
      toast({ title: "Excel-Export erfolgreich", description: destPath });
    } catch (err) {
      toast({ variant: "destructive", title: "Export fehlgeschlagen", description: String(err) });
    }
  };

  const allEntries = activeTimetable?.entries ?? [];

  const displayedClasses =
    selectedClassName === "all"
      ? classes
      : classes.filter((c) => c.name === selectedClassName);

  const displayedTeachers =
    selectedTeacherAbbr === "all"
      ? teachers
      : teachers.filter((t) => t.abbreviation === selectedTeacherAbbr);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Stundenplan</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Stundenplan generieren, ansehen und exportieren
          </p>
        </div>
        <div className="flex gap-2">
          {activeTimetable && (
            <Button variant="outline" onClick={handleExportExcel}>
              <Download className="h-4 w-4" />
              Excel-Export
            </Button>
          )}
          <Button onClick={handleGenerate} disabled={generating}>
            <Play className="h-4 w-4" />
            {generating ? "Generieren..." : "Stundenplan generieren"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Schuljahr</Label>
          <Input
            value={schoolYear}
            onChange={(e) => setSchoolYear(e.target.value)}
            placeholder="2024/2025"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Vorhandene Stundenpläne</Label>
          <Select
            value={activeTimetable?.id.toString() ?? "none"}
            onValueChange={(v) => {
              if (v === "none") {
                setActive(null);
              } else {
                const found = timetables.find((t) => String(t.id) === v);
                setActive(found ?? null);
              }
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Stundenplan wählen..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">– Keinen auswählen –</SelectItem>
              {timetables.map((t) => (
                <SelectItem key={t.id} value={t.id.toString()}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-1">
          <div className="flex items-center gap-2 text-amber-800 font-medium text-sm">
            <AlertTriangle className="h-4 w-4" />
            Warnungen
          </div>
          {warnings.map((w, i) => (
            <p key={i} className="text-sm text-amber-700 pl-6">
              {w}
            </p>
          ))}
        </div>
      )}

      {activeTimetable && (
        <>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* View mode toggle */}
              <div className="flex rounded-md border border-gray-200 overflow-hidden text-sm">
                <button
                  className={`px-3 py-1.5 font-medium transition-colors ${
                    viewMode === "classes"
                      ? "bg-primary text-white"
                      : "bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                  onClick={() => setViewMode("classes")}
                >
                  Klassen
                </button>
                <button
                  className={`px-3 py-1.5 font-medium border-l border-gray-200 transition-colors ${
                    viewMode === "teachers"
                      ? "bg-primary text-white"
                      : "bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                  onClick={() => setViewMode("teachers")}
                >
                  Lehrkräfte
                </button>
              </div>

              {/* Filter selector */}
              {viewMode === "classes" ? (
                <Select value={selectedClassName} onValueChange={setSelectedClassName}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alle Klassen</SelectItem>
                    {classes.map((c) => (
                      <SelectItem key={c.id} value={c.name}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Select value={selectedTeacherAbbr} onValueChange={setSelectedTeacherAbbr}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alle Lehrkräfte</SelectItem>
                    {teachers.map((t) => (
                      <SelectItem key={t.id} value={t.abbreviation}>
                        {t.last_name}, {t.first_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleDelete(activeTimetable)}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
              Löschen
            </Button>
          </div>

          <div className="space-y-6">
            {viewMode === "classes"
              ? displayedClasses.map((cls) => {
                  const entries = allEntries.filter((e) => e.class_name === cls.name);
                  if (entries.length === 0 && selectedClassName !== "all") return null;
                  const maxSlot = entries.reduce((m, e) => Math.max(m, e.slot), 6);
                  const isThisClassDragging = dragEntry?.class_name === cls.name;
                  return (
                    <TimetableGrid
                      key={cls.id}
                      title={`Klasse ${cls.name}`}
                      entries={entries}
                      maxSlot={maxSlot}
                      getCellClass={(day, slot) => {
                        const matching = entries.filter((e) => e.day === day && e.slot === slot);
                        if (matching.length > 1) return "rounded overflow-hidden text-xs";
                        const e = matching[0];
                        return e?.is_double_staffed
                          ? "rounded px-1.5 py-1 text-xs bg-emerald-50 border border-emerald-300"
                          : "rounded px-1.5 py-1 text-xs bg-primary/10 border border-primary/20";
                      }}
                      renderCell={(day, slot) => {
                        const matching = entries.filter((e) => e.day === day && e.slot === slot);
                        if (matching.length === 0) return null;
                        if (matching.length === 1) {
                          const e = matching[0];
                          return (
                            <>
                              <div className="font-medium">{e.subject_name}</div>
                              <div className="text-muted-foreground">
                                {e.teacher_abbreviation}
                                {e.is_double_staffed && e.second_teacher_abbreviation && (
                                  <span className="text-emerald-700"> + {e.second_teacher_abbreviation}</span>
                                )}
                              </div>
                            </>
                          );
                        }
                        return (
                          <div className="flex divide-x divide-primary/20">
                            {matching.map((e, i) => (
                              <div
                                key={i}
                                className={`flex-1 px-1.5 py-1 ${e.is_double_staffed ? "bg-emerald-50" : "bg-primary/10"}`}
                              >
                                <div className="font-medium">{e.subject_name}</div>
                                <div className="text-muted-foreground">
                                  {e.teacher_abbreviation}
                                  {e.is_double_staffed && e.second_teacher_abbreviation && (
                                    <span className="text-emerald-700"> + {e.second_teacher_abbreviation}</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      }}
                      onCellDragStart={(day, slot) => {
                        const matching = entries.filter((e) => e.day === day && e.slot === slot);
                        if (matching.length === 1) {
                          dragEntryRef.current = matching[0];
                          setDragEntry(matching[0]);
                        }
                      }}
                      onCellDrop={(day, slot) => {
                        const de = dragEntryRef.current;
                        dragEntryRef.current = null;
                        setDragEntry(null);
                        if (!de) return;
                        const matching = entries.filter((e) => e.day === day && e.slot === slot);
                        if (matching.length !== 1) return;
                        if (matching[0].teacher_id !== de.teacher_id) return;
                        if (matching[0].id === de.id) return;
                        if (!isValidSwap(de, matching[0], allEntries, subjects)) return;
                        swapEntries(de.id, matching[0].id).catch((err) => {
                          toast({ variant: "destructive", title: "Fehler beim Tauschen", description: String(err) });
                        });
                      }}
                      onDragEnd={() => {
                        dragEntryRef.current = null;
                        setDragEntry(null);
                      }}
                      cellDragState={(day, slot) => {
                        if (!isThisClassDragging || !dragEntry) return null;
                        if (dragEntry.day === day && dragEntry.slot === slot) return "source";
                        const matching = entries.filter((e) => e.day === day && e.slot === slot);
                        if (matching.length !== 1) return null;
                        if (matching[0].teacher_id !== dragEntry.teacher_id) return null;
                        if (!isValidSwap(dragEntry, matching[0], allEntries, subjects)) return null;
                        return "valid-target";
                      }}
                    />
                  );
                })
              : displayedTeachers.map((teacher) => {
                  const entries = allEntries.filter(
                    (e) =>
                      e.teacher_abbreviation === teacher.abbreviation ||
                      (e.is_double_staffed && e.second_teacher_abbreviation === teacher.abbreviation),
                  );
                  if (entries.length === 0 && selectedTeacherAbbr !== "all") return null;
                  const maxSlot = entries.reduce((m, e) => Math.max(m, e.slot), 6);
                  return (
                    <TimetableGrid
                      key={teacher.id}
                      title={`${teacher.last_name}, ${teacher.first_name} (${teacher.abbreviation})`}
                      entries={entries}
                      maxSlot={maxSlot}
                      getCellClass={(day, slot) => {
                        const matching = entries.filter((e) => e.day === day && e.slot === slot);
                        const e = matching[0];
                        if (!e) return "rounded px-1.5 py-1 text-xs bg-primary/10 border border-primary/20";
                        const isSecondary = e.is_double_staffed && e.second_teacher_abbreviation === teacher.abbreviation;
                        return isSecondary
                          ? "rounded px-1.5 py-1 text-xs bg-emerald-50 border border-emerald-300"
                          : "rounded px-1.5 py-1 text-xs bg-primary/10 border border-primary/20";
                      }}
                      renderCell={(day, slot) => {
                        const matching = entries.filter((e) => e.day === day && e.slot === slot);
                        if (matching.length === 0) return null;
                        if (matching.length === 1) {
                          const e = matching[0];
                          return (
                            <>
                              <div className="font-medium">{e.subject_name}</div>
                              <div className="text-muted-foreground">{e.class_name}</div>
                            </>
                          );
                        }
                        // Coupled group: same subject taught to multiple classes → single tile
                        const allSameSubject = matching.every((e) => e.subject_id === matching[0].subject_id);
                        if (allSameSubject) {
                          const names = matching.map((e) => e.class_name);
                          const classLabel = names.length === 2 ? names.join(" + ") : names.join(", ");
                          return (
                            <>
                              <div className="font-medium">{matching[0].subject_name}</div>
                              <div className="text-muted-foreground">{classLabel}</div>
                            </>
                          );
                        }
                        // Fallback: different subjects at same slot (edge case)
                        return (
                          <div className="flex divide-x divide-primary/20">
                            {matching.map((e, i) => (
                              <div key={i} className="flex-1 px-1.5 py-1 bg-primary/10">
                                <div className="font-medium">{e.subject_name}</div>
                                <div className="text-muted-foreground">{e.class_name}</div>
                              </div>
                            ))}
                          </div>
                        );
                      }}
                    />
                  );
                })}
          </div>
        </>
      )}

      {!activeTimetable && !loading && (
        <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground border rounded-lg">
          <CalendarDays className="h-8 w-8 opacity-30" />
          <p className="text-sm">Kein Stundenplan ausgewählt</p>
          <Button variant="outline" size="sm" onClick={handleGenerate} disabled={generating}>
            <Play className="h-4 w-4" />
            Jetzt generieren
          </Button>
        </div>
      )}
    </div>
  );
}

function TimetableGrid({
  title,
  entries,
  maxSlot,
  renderCell,
  getCellClass,
  onCellDragStart,
  onCellDrop,
  onDragEnd,
  cellDragState,
}: {
  title: string;
  entries: { day: Weekday; slot: number }[];
  maxSlot: number;
  renderCell: (day: Weekday, slot: number) => ReactNode;
  getCellClass?: (day: Weekday, slot: number) => string;
  onCellDragStart?: (day: Weekday, slot: number) => void;
  onCellDrop?: (day: Weekday, slot: number) => void;
  onDragEnd?: () => void;
  cellDragState?: (day: Weekday, slot: number) => "source" | "valid-target" | null;
}) {
  // Pointer-based drag: bypasses WKWebView's HTML5 D&D interception
  const draggingRef = useRef(false);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>, day: Weekday, slot: number) => {
    if (!onCellDragStart) return;
    e.preventDefault();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    (e.currentTarget as HTMLDivElement).style.cursor = "grabbing";
    draggingRef.current = true;
    onCellDragStart(day, slot);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    (e.currentTarget as HTMLDivElement).style.cursor = "grab";
    (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);

    // Find which table cell is under the cursor at release
    const els = document.elementsFromPoint(e.clientX, e.clientY);
    const targetTd = els.find(
      (el) => el instanceof HTMLTableCellElement && el.hasAttribute("data-day"),
    ) as HTMLTableCellElement | undefined;

    if (targetTd && onCellDrop) {
      const targetDay = Number(targetTd.dataset.day) as Weekday;
      const targetSlot = Number(targetTd.dataset.slot);
      onCellDrop(targetDay, targetSlot);
    } else {
      onDragEnd?.();
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    (e.currentTarget as HTMLDivElement).style.cursor = "grab";
    onDragEnd?.();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse table-fixed">
            <thead>
              <tr className="bg-muted/50">
                <th className="text-left p-2 font-medium border-b border-r w-16">Std.</th>
                {WEEKDAYS.map((wd) => (
                  <th key={wd.value} className="text-center p-2 font-medium border-b border-r">
                    {wd.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: maxSlot }, (_, i) => i + 1).map((slot) => (
                <tr key={slot} className="border-b">
                  <td className="p-2 text-center font-medium text-muted-foreground border-r bg-muted/20">
                    {slot}.
                  </td>
                  {([1, 2, 3, 4, 5] as Weekday[]).map((day) => {
                    const hasEntry = entries.some((e) => e.day === day && e.slot === slot);
                    const ds = cellDragState ? cellDragState(day, slot) : null;
                    const isValidTarget = ds === "valid-target";
                    return (
                      <td
                        key={day}
                        data-day={day}
                        data-slot={slot}
                        className={`p-1 border-r align-top transition-colors${isValidTarget ? " bg-blue-50" : ""}`}
                      >
                        {hasEntry ? (
                          <div
                            className={`${getCellClass ? getCellClass(day, slot) : "rounded px-1.5 py-1 text-xs bg-primary/10 border border-primary/20"}${ds === "source" ? " opacity-50" : ds === "valid-target" ? " ring-2 ring-blue-400" : ""}`}
                            onPointerDown={onCellDragStart ? (e) => handlePointerDown(e, day, slot) : undefined}
                            onPointerUp={onCellDragStart ? handlePointerUp : undefined}
                            onPointerCancel={onCellDragStart ? handlePointerCancel : undefined}
                            style={onCellDragStart ? { cursor: "grab", userSelect: "none" } : undefined}
                          >
                            {renderCell(day, slot)}
                          </div>
                        ) : (
                          <div className="h-10" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
