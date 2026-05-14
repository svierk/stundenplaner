import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Subject, SubjectFormData, Weekday, GradeLevel, SubjectCategory, SchoolClass } from "@/types";
import { WEEKDAYS, GRADE_LEVELS, MAX_SLOTS_PER_DAY, SUBJECT_CATEGORIES } from "@/types";

interface SubjectFormProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: SubjectFormData) => Promise<void>;
  initial?: Subject;
  allSubjects: Subject[];
  allClasses: SchoolClass[];
}

const defaultGradeConfig = (grade: GradeLevel) => ({
  grade_level: grade,
  hours_per_week: 0,
  category_override: undefined as SubjectCategory | undefined,
});

export function SubjectForm({ open, onClose, onSubmit, initial, allSubjects, allClasses }: SubjectFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState<SubjectCategory>(initial?.category ?? "minor");
  const [gradeConfigs, setGradeConfigs] = useState(
    initial?.grade_configs.length
      ? initial.grade_configs.map((g) => ({
          grade_level: g.grade_level,
          hours_per_week: g.hours_per_week,
          category_override: g.category_override,
        }))
      : GRADE_LEVELS.map(defaultGradeConfig),
  );
  const [allowedDays, setAllowedDays] = useState<Weekday[]>(
    initial?.allowed_days.length ? initial.allowed_days : [1, 2, 3, 4, 5],
  );
  const [allowedSlots, setAllowedSlots] = useState<number[]>(initial?.allowed_slots ?? []);
  const [noDoublePeriods, setNoDoublePeriods] = useState(initial?.no_double_periods ?? false);
  const [noDoubleStaffing, setNoDoubleStaffing] = useState(initial?.no_double_staffing ?? false);
  const [noRepeatPerDay, setNoRepeatPerDay] = useState(initial?.no_repeat_per_day ?? false);
  const [mustBeBoundary, setMustBeBoundary] = useState(initial?.must_be_boundary ?? false);
  const [noParallelClasses, setNoParallelClasses] = useState(initial?.no_parallel_classes ?? false);
  const [noParallelSubjectIds, setNoParallelSubjectIds] = useState<number[]>(
    initial?.no_parallel_subject_ids ?? [],
  );
  const [coupledClassIds, setCoupledClassIds] = useState<number[]>(
    initial?.coupled_class_ids ?? [],
  );
  const [parallelPartnerIds, setParallelPartnerIds] = useState<number[]>(
    initial?.parallel_partner_subject_ids ?? [],
  );

  const toggleParallelPartner = (id: number) =>
    setParallelPartnerIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  const [saving, setSaving] = useState(false);

  const otherSubjects = allSubjects.filter((s) => s.id !== initial?.id);

  const toggleNoParallelSubject = (id: number) =>
    setNoParallelSubjectIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );

  const toggleCoupledClass = (id: number) =>
    setCoupledClassIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );

  const toggleDay = (day: Weekday) => {
    setAllowedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort() as Weekday[],
    );
  };

  const toggleSlot = (slot: number) => {
    setAllowedSlots((prev) =>
      prev.includes(slot) ? prev.filter((s) => s !== slot) : [...prev, slot].sort((a, b) => a - b),
    );
  };

  const updateGradeConfig = (grade: GradeLevel, value: number) => {
    setGradeConfigs((prev) =>
      prev.map((gc) => (gc.grade_level === grade ? { ...gc, hours_per_week: value } : gc)),
    );
  };

  const updateGradeCategoryOverride = (grade: GradeLevel, value: SubjectCategory | undefined) => {
    setGradeConfigs((prev) =>
      prev.map((gc) => (gc.grade_level === grade ? { ...gc, category_override: value } : gc)),
    );
  };

  const toggleGrade = (grade: GradeLevel) => {
    setGradeConfigs((prev) => {
      const exists = prev.some((g) => g.grade_level === grade);
      if (exists) return prev.filter((g) => g.grade_level !== grade);
      return [...prev, defaultGradeConfig(grade)].sort((a, b) => a.grade_level - b.grade_level);
    });
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        category,
        grade_configs: gradeConfigs,
        allowed_days: allowedDays,
        allowed_slots: allowedSlots,
        no_double_periods: noDoublePeriods,
        no_double_staffing: noDoubleStaffing,
        no_repeat_per_day: noRepeatPerDay,
        must_be_boundary: mustBeBoundary,
        no_parallel_classes: noParallelClasses,
        no_parallel_subject_ids: noParallelClasses ? noParallelSubjectIds : [],
        coupled_class_ids: coupledClassIds,
        parallel_partner_subject_ids: parallelPartnerIds,
      });
      onClose();
    } catch {
      // error displayed by parent via toast
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Fach bearbeiten" : "Neues Fach"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Fachname</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z.B. Deutsch"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Kategorie</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as SubjectCategory)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUBJECT_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Klassenstufen & Wochenstunden</Label>
            <div className="rounded-md border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left p-2 font-medium w-10">Aktiv</th>
                    <th className="text-left p-2 font-medium">Klasse</th>
                    <th className="text-left p-2 font-medium">Std/Woche</th>
                    <th className="text-left p-2 font-medium">Kategorie</th>
                  </tr>
                </thead>
                <tbody>
                  {GRADE_LEVELS.map((grade) => {
                    const config = gradeConfigs.find((g) => g.grade_level === grade);
                    const active = !!config;
                    return (
                      <tr key={grade} className="border-t">
                        <td className="p-2">
                          <Checkbox
                            checked={active}
                            onCheckedChange={() => toggleGrade(grade)}
                          />
                        </td>
                        <td className="p-2 font-medium">Klasse {grade}</td>
                        <td className="p-2">
                          <Input
                            type="number"
                            min={0}
                            max={10}
                            disabled={!active}
                            value={config?.hours_per_week ?? 0}
                            onChange={(e) => updateGradeConfig(grade, Number(e.target.value))}
                            className="w-20"
                          />
                        </td>
                        <td className="p-2">
                          <Select
                            disabled={!active}
                            value={config?.category_override ?? "inherit"}
                            onValueChange={(v) =>
                              updateGradeCategoryOverride(
                                grade,
                                v === "inherit" ? undefined : v as SubjectCategory,
                              )
                            }
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="inherit">
                                <span className="text-muted-foreground">Standard</span>
                              </SelectItem>
                              {SUBJECT_CATEGORIES.map((c) => (
                                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Erlaubte Wochentage</Label>
            <div className="flex gap-2 flex-wrap">
              {WEEKDAYS.map((wd) => (
                <label
                  key={wd.value}
                  className="flex items-center gap-1.5 cursor-pointer select-none"
                >
                  <Checkbox
                    checked={allowedDays.includes(wd.value)}
                    onCheckedChange={() => toggleDay(wd.value)}
                  />
                  <span className="text-sm">{wd.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>
              Erlaubte Unterrichtsstunden{" "}
              <span className="text-muted-foreground font-normal">(leer = alle Stunden erlaubt)</span>
            </Label>
            <div className="flex gap-2 flex-wrap">
              {Array.from({ length: MAX_SLOTS_PER_DAY }, (_, i) => i + 1).map((slot) => (
                <label
                  key={slot}
                  className="flex items-center gap-1.5 cursor-pointer select-none"
                >
                  <Checkbox
                    checked={allowedSlots.includes(slot)}
                    onCheckedChange={() => toggleSlot(slot)}
                  />
                  <span className="text-sm">{slot}. Stunde</span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Einschränkungen</Label>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={noDoublePeriods}
                  onCheckedChange={(v) => setNoDoublePeriods(!!v)}
                />
                <span className="text-sm">Keine Doppelstunden</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={noDoubleStaffing}
                  onCheckedChange={(v) => setNoDoubleStaffing(!!v)}
                />
                <span className="text-sm">Keine Doppelbesetzung</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={noRepeatPerDay}
                  onCheckedChange={(v) => setNoRepeatPerDay(!!v)}
                />
                <span className="text-sm">Nicht mehrfach am gleichen Tag</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={mustBeBoundary}
                  onCheckedChange={(v) => setMustBeBoundary(!!v)}
                />
                <span className="text-sm">Muss Randstunde sein</span>
              </label>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="noParallelClasses"
                checked={noParallelClasses}
                onCheckedChange={(v) => {
                  setNoParallelClasses(!!v);
                  if (!v) setNoParallelSubjectIds([]);
                }}
              />
              <Label htmlFor="noParallelClasses">Kein Parallelunterricht (klassenübergreifend)</Label>
            </div>

            {noParallelClasses && otherSubjects.length > 0 && (
              <div className="pl-6 space-y-1.5">
                <Label className="text-sm text-muted-foreground">
                  Auch nicht parallel zu (optional)
                </Label>
                <div className="rounded-md border border-gray-200 p-2 max-h-36 overflow-y-auto space-y-1 bg-gray-50">
                  {otherSubjects.map((s) => (
                    <label
                      key={s.id}
                      className="flex items-center gap-2 cursor-pointer p-1 rounded hover:bg-blue-50 transition-colors"
                    >
                      <Checkbox
                        checked={noParallelSubjectIds.includes(s.id)}
                        onCheckedChange={() => toggleNoParallelSubject(s.id)}
                      />
                      <span className="text-sm">{s.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Parallelunterricht ─────────────────────────────────────────── */}
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3 space-y-3">
            <p className="text-sm font-medium">Parallelunterricht</p>

            {/* Option A – klassenübergreifend, selbe Lehrkraft (Fall 2 & 3) */}
            <div className="space-y-1.5">
              <Label className="text-sm">
                Wird für folgende Klassen gleichzeitig von derselben Lehrkraft unterrichtet
                <span className="text-muted-foreground font-normal"> (leer = kein gemeinsamer Unterricht)</span>
              </Label>
              {allClasses.length === 0 ? (
                <p className="text-xs text-muted-foreground pl-1">Noch keine Klassen angelegt.</p>
              ) : (
                <div className="rounded-md border border-gray-200 p-2 max-h-32 overflow-y-auto space-y-1 bg-white">
                  {allClasses.map((c) => (
                    <label
                      key={c.id}
                      className="flex items-center gap-2 cursor-pointer p-1 rounded hover:bg-blue-50 transition-colors"
                    >
                      <Checkbox
                        checked={coupledClassIds.includes(c.id)}
                        onCheckedChange={() => toggleCoupledClass(c.id)}
                      />
                      <span className="text-sm">{c.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Option B – parallele Partnerfächer pro Klasse (Fall 1 & 3) */}
            <div className="space-y-1.5">
              <Label className="text-sm">
                Findet parallel zu folgenden Fächern statt (pro Klasse, eigene Lehrkraft)
                <span className="text-muted-foreground font-normal"> (Pflichtbedingung, Mehrfachauswahl möglich)</span>
              </Label>
              {otherSubjects.length === 0 ? (
                <p className="text-xs text-muted-foreground pl-1">Noch keine anderen Fächer vorhanden.</p>
              ) : (
                <div className="rounded-md border border-gray-200 p-2 max-h-32 overflow-y-auto space-y-1 bg-white">
                  {otherSubjects.map((s) => (
                    <label
                      key={s.id}
                      className="flex items-center gap-2 cursor-pointer p-1 rounded hover:bg-blue-50 transition-colors"
                    >
                      <Checkbox
                        checked={parallelPartnerIds.includes(s.id)}
                        onCheckedChange={() => toggleParallelPartner(s.id)}
                      />
                      <span className="text-sm">{s.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Abbrechen
          </Button>
          <Button onClick={handleSubmit} disabled={!name.trim() || saving}>
            {saving ? "Speichern..." : "Speichern"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
