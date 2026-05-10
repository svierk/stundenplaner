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
import type { SchoolClass, ClassFormData, Subject, GradeLevel } from "@/types";
import { GRADE_LEVELS } from "@/types";

interface ClassFormProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: ClassFormData) => Promise<void>;
  initial?: SchoolClass;
  subjects: Subject[];
}

export function ClassForm({ open, onClose, onSubmit, initial, subjects }: ClassFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [gradeLevel, setGradeLevel] = useState<GradeLevel>(initial?.grade_level ?? 1);
  const [hoursPerWeek, setHoursPerWeek] = useState(initial?.hours_per_week ?? 25);
  const [maxHoursPerDay, setMaxHoursPerDay] = useState(initial?.max_hours_per_day ?? 6);
  const [allowFreePeriods, setAllowFreePeriods] = useState(initial?.allow_free_periods ?? false);
  const [classSubjects, setClassSubjects] = useState<{ subject_id: number; hours_per_week: number }[]>(
    initial?.subjects.map((s) => ({ subject_id: s.subject_id, hours_per_week: s.hours_per_week })) ?? [],
  );
  const [saving, setSaving] = useState(false);

  const toggleSubject = (subjectId: number) => {
    setClassSubjects((prev) => {
      const exists = prev.some((s) => s.subject_id === subjectId);
      if (exists) return prev.filter((s) => s.subject_id !== subjectId);
      return [...prev, { subject_id: subjectId, hours_per_week: 0 }];
    });
  };

  const updateHours = (subjectId: number, hours: number) => {
    setClassSubjects((prev) =>
      prev.map((s) => (s.subject_id === subjectId ? { ...s, hours_per_week: hours } : s)),
    );
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        grade_level: gradeLevel,
        hours_per_week: hoursPerWeek,
        max_hours_per_day: maxHoursPerDay,
        allow_free_periods: allowFreePeriods,
        subjects: classSubjects,
      });
      onClose();
    } catch {
      // error displayed by parent via toast
    } finally {
      setSaving(false);
    }
  };

  const eligibleSubjects = subjects.filter((s) =>
    s.grade_configs.some((gc) => gc.grade_level === gradeLevel),
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Klasse bearbeiten" : "Neue Klasse"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Klassenbezeichnung</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z.B. 3a"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Klassenstufe</Label>
              <Select
                value={gradeLevel.toString()}
                onValueChange={(v) => {
                  setGradeLevel(Number(v) as GradeLevel);
                  setClassSubjects([]);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GRADE_LEVELS.map((g) => (
                    <SelectItem key={g} value={g.toString()}>
                      Klasse {g}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Stunden pro Woche</Label>
              <Input
                type="number"
                min={1}
                max={40}
                value={hoursPerWeek}
                onChange={(e) => setHoursPerWeek(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Max. Stunden pro Tag</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={maxHoursPerDay}
                onChange={(e) => setMaxHoursPerDay(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="freePeriods"
              checked={allowFreePeriods}
              onCheckedChange={(v) => setAllowFreePeriods(!!v)}
            />
            <Label htmlFor="freePeriods">Freistunden erlauben</Label>
          </div>

          <div className="space-y-2">
            <Label>Fächer & Stunden pro Woche</Label>
            {eligibleSubjects.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Keine Fächer für Klassenstufe {gradeLevel} konfiguriert.
              </p>
            ) : (
              <div className="rounded-md border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="text-left p-2 font-medium w-10">Aktiv</th>
                      <th className="text-left p-2 font-medium">Fach</th>
                      <th className="text-left p-2 font-medium">Std/Woche</th>
                      <th className="text-left p-2 font-medium text-muted-foreground text-xs">
                        Erlaubt
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {eligibleSubjects.map((subject) => {
                      const cs = classSubjects.find((s) => s.subject_id === subject.id);
                      const gradeConfig = subject.grade_configs.find(
                        (gc) => gc.grade_level === gradeLevel,
                      );
                      return (
                        <tr key={subject.id} className="border-t">
                          <td className="p-2">
                            <Checkbox
                              checked={!!cs}
                              onCheckedChange={() => toggleSubject(subject.id)}
                            />
                          </td>
                          <td className="p-2 font-medium">{subject.name}</td>
                          <td className="p-2">
                            <Input
                              type="number"
                              min={0}
                              max={gradeConfig?.hours_per_week ?? 10}
                              disabled={!cs}
                              value={cs?.hours_per_week ?? 0}
                              onChange={(e) => updateHours(subject.id, Number(e.target.value))}
                              className="w-20"
                            />
                          </td>
                          <td className="p-2 text-xs text-muted-foreground">
                            {gradeConfig ? `${gradeConfig.hours_per_week} Std` : "–"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
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
