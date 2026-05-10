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
import type { Subject, SubjectFormData, Weekday, GradeLevel } from "@/types";
import { WEEKDAYS, GRADE_LEVELS, MAX_SLOTS_PER_DAY } from "@/types";

interface SubjectFormProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: SubjectFormData) => Promise<void>;
  initial?: Subject;
}

const defaultGradeConfig = (grade: GradeLevel) => ({
  grade_level: grade,
  hours_per_week: 0,
});

export function SubjectForm({ open, onClose, onSubmit, initial }: SubjectFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [gradeConfigs, setGradeConfigs] = useState(
    initial?.grade_configs.length
      ? initial.grade_configs.map((g) => ({
          grade_level: g.grade_level,
          hours_per_week: g.hours_per_week,
        }))
      : GRADE_LEVELS.map(defaultGradeConfig),
  );
  const [allowedDays, setAllowedDays] = useState<Weekday[]>(
    initial?.allowed_days.length ? initial.allowed_days : [1, 2, 3, 4, 5],
  );
  const [allowedSlots, setAllowedSlots] = useState<number[]>(initial?.allowed_slots ?? []);
  const [saving, setSaving] = useState(false);

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
      await onSubmit({ name: name.trim(), grade_configs: gradeConfigs, allowed_days: allowedDays, allowed_slots: allowedSlots });
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
          <div className="space-y-1.5">
            <Label>Fachname</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z.B. Deutsch"
            />
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
              Eingeschränkte Unterrichtsstunden{" "}
              <span className="text-muted-foreground font-normal">(leer = alle Stunden)</span>
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
