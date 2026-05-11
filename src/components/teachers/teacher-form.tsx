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
import type {
  Teacher,
  TeacherFormData,
  Subject,
  SchoolClass,
  Weekday,
  AllowedSubjectEntry,
} from "@/types";
import { WEEKDAYS } from "@/types";

interface TeacherFormProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: TeacherFormData) => Promise<void>;
  initial?: Teacher;
  subjects: Subject[];
  classes: SchoolClass[];
}

function AllowedSubjectSelect({
  subjects,
  classes,
  allowed,
  onChange,
}: {
  subjects: Subject[];
  classes: SchoolClass[];
  allowed: AllowedSubjectEntry[];
  onChange: (entries: AllowedSubjectEntry[]) => void;
}) {
  const toggleSubject = (id: number) => {
    if (allowed.some((a) => a.subject_id === id)) {
      onChange(allowed.filter((a) => a.subject_id !== id));
    } else {
      onChange([...allowed, { subject_id: id, class_ids: [] }]);
    }
  };

  const toggleClass = (subjectId: number, classId: number) => {
    onChange(
      allowed.map((a) => {
        if (a.subject_id !== subjectId) return a;
        const newClassIds = a.class_ids.includes(classId)
          ? a.class_ids.filter((c) => c !== classId)
          : [...a.class_ids, classId];
        return { ...a, class_ids: newClassIds };
      }),
    );
  };

  return (
    <div className="space-y-1.5">
      <Label>Erlaubte Fächer</Label>
      <div className="rounded-md border border-gray-200 p-2 max-h-52 overflow-y-auto space-y-1 bg-gray-50">
        {subjects.length === 0 ? (
          <p className="text-xs text-muted-foreground p-1">Keine Fächer vorhanden</p>
        ) : (
          subjects.map((s) => {
            const entry = allowed.find((a) => a.subject_id === s.id);
            const isSelected = !!entry;
            return (
              <div key={s.id}>
                <label className="flex items-center gap-2 cursor-pointer p-1 rounded hover:bg-blue-50 transition-colors">
                  <Checkbox checked={isSelected} onCheckedChange={() => toggleSubject(s.id)} />
                  <span className="text-sm">{s.name}</span>
                  {isSelected && (
                    <span className="text-xs text-muted-foreground ml-auto">
                      {entry!.class_ids.length === 0 ? "Alle Klassen" : `${entry!.class_ids.length} Klasse(n)`}
                    </span>
                  )}
                </label>
                {isSelected && classes.length > 0 && (
                  <div className="ml-6 mt-0.5 mb-1 flex gap-3 flex-wrap">
                    {classes.map((c) => (
                      <label key={c.id} className="flex items-center gap-1.5 cursor-pointer text-xs">
                        <Checkbox
                          checked={entry!.class_ids.includes(c.id)}
                          onCheckedChange={() => toggleClass(s.id, c.id)}
                        />
                        <span>{c.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Ohne Klassenauswahl wird das Fach für beliebige Klassen bevorzugt.
      </p>
    </div>
  );
}

function ForbiddenSubjectSelect({
  subjects,
  selected,
  onChange,
}: {
  subjects: Subject[];
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  const toggle = (id: number) =>
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);

  return (
    <div className="space-y-1.5">
      <Label>Nicht erlaubte Fächer</Label>
      <div className="rounded-md border border-gray-200 p-2 max-h-36 overflow-y-auto space-y-1 bg-gray-50">
        {subjects.length === 0 ? (
          <p className="text-xs text-muted-foreground p-1">Keine Fächer vorhanden</p>
        ) : (
          subjects.map((s) => (
            <label
              key={s.id}
              className="flex items-center gap-2 cursor-pointer p-1 rounded hover:bg-blue-50 transition-colors"
            >
              <Checkbox checked={selected.includes(s.id)} onCheckedChange={() => toggle(s.id)} />
              <span className="text-sm">{s.name}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

export function TeacherForm({ open, onClose, onSubmit, initial, subjects, classes }: TeacherFormProps) {
  const [firstName, setFirstName] = useState(initial?.first_name ?? "");
  const [lastName, setLastName] = useState(initial?.last_name ?? "");
  const [abbreviation, setAbbreviation] = useState(initial?.abbreviation ?? "");
  const [hoursPerWeek, setHoursPerWeek] = useState(initial?.hours_per_week ?? 28);
  const [isClassTeacher, setIsClassTeacher] = useState(initial?.is_class_teacher ?? false);
  const [hasFreeDay, setHasFreeDay] = useState(initial?.has_free_day ?? false);
  const [freeDays, setFreeDays] = useState<Weekday[]>(initial?.free_days ?? []);
  const [ownClassId, setOwnClassId] = useState<number | null>(initial?.own_class_id ?? null);
  const [allowedSubjects, setAllowedSubjects] = useState<AllowedSubjectEntry[]>(
    initial?.allowed_subjects ?? [],
  );
  const [forbiddenSubjectIds, setForbiddenSubjectIds] = useState<number[]>(
    initial?.forbidden_subject_ids ?? [],
  );
  const [hasAdditionalDuty, setHasAdditionalDuty] = useState(!!initial?.additional_duty_name);
  const [additionalDutyName, setAdditionalDutyName] = useState(initial?.additional_duty_name ?? "");
  const [additionalDutyHours, setAdditionalDutyHours] = useState(initial?.additional_duty_hours ?? 1);
  const [hasFreeSlots, setHasFreeSlots] = useState(initial?.has_free_slots ?? false);
  const [freeSlots, setFreeSlots] = useState<number[]>(initial?.free_slots ?? []);
  const [saving, setSaving] = useState(false);

  const toggleFreeDay = (day: Weekday) => {
    setFreeDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort() as Weekday[],
    );
  };

  const toggleFreeSlot = (slot: number) => {
    setFreeSlots((prev) =>
      prev.includes(slot) ? prev.filter((s) => s !== slot) : [...prev, slot].sort((a, b) => a - b),
    );
  };

  const handleSubmit = async () => {
    if (!firstName.trim() || !lastName.trim() || !abbreviation.trim()) return;
    setSaving(true);
    try {
      await onSubmit({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        abbreviation: abbreviation.trim(),
        hours_per_week: hoursPerWeek,
        is_class_teacher: isClassTeacher,
        has_free_day: hasFreeDay,
        free_days: hasFreeDay ? freeDays : [],
        own_class_id: isClassTeacher ? ownClassId : null,
        allowed_subjects: allowedSubjects,
        forbidden_subject_ids: forbiddenSubjectIds,
        additional_duty_name: hasAdditionalDuty ? additionalDutyName.trim() || null : null,
        additional_duty_hours: hasAdditionalDuty ? additionalDutyHours : 0,
        has_free_slots: hasFreeSlots,
        free_slots: hasFreeSlots ? freeSlots : [],
      });
      onClose();
    } catch {
      // error displayed by parent via toast
    } finally {
      setSaving(false);
    }
  };

  const isValid = firstName.trim() && lastName.trim() && abbreviation.trim();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Lehrkraft bearbeiten" : "Neue Lehrkraft"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Vorname</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Max" />
            </div>
            <div className="space-y-1.5">
              <Label>Nachname</Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Mustermann" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Kürzel</Label>
              <Input
                value={abbreviation}
                onChange={(e) => setAbbreviation(e.target.value)}
                placeholder="MUS"
                maxLength={5}
              />
            </div>
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
          </div>

          <div className="rounded-md border border-gray-200 divide-y divide-gray-200">

            {/* Kann Klassenleitung sein */}
            <div className="space-y-2 p-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="classTeacher"
                  checked={isClassTeacher}
                  onCheckedChange={(v) => setIsClassTeacher(!!v)}
                />
                <Label htmlFor="classTeacher">Kann Klassenleitung sein</Label>
              </div>
              {isClassTeacher && (
                <div className="pl-6 space-y-1.5">
                  <Label className="text-sm text-muted-foreground">Eigene Klasse (optional)</Label>
                  <Select
                    value={ownClassId?.toString() ?? "none"}
                    onValueChange={(v) => setOwnClassId(v === "none" ? null : Number(v))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Keine Zuweisung" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Keine Zuweisung</SelectItem>
                      {classes.map((c) => (
                        <SelectItem key={c.id} value={c.id.toString()}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Hat Zusatzaufgabe */}
            <div className="space-y-2 p-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="additionalDuty"
                  checked={hasAdditionalDuty}
                  onCheckedChange={(v) => setHasAdditionalDuty(!!v)}
                />
                <Label htmlFor="additionalDuty">Hat Zusatzaufgabe</Label>
              </div>
              {hasAdditionalDuty && (
                <div className="pl-6 grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-sm text-muted-foreground">Bezeichnung</Label>
                    <Input
                      value={additionalDutyName}
                      onChange={(e) => setAdditionalDutyName(e.target.value)}
                      placeholder="z.B. Schulleitung, Beratung"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm text-muted-foreground">Stundenreduktion/Woche</Label>
                    <Input
                      type="number"
                      min={1}
                      max={hoursPerWeek}
                      value={additionalDutyHours}
                      onChange={(e) => setAdditionalDutyHours(Number(e.target.value))}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Hat freien Tag */}
            <div className="space-y-2 p-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="freeDay"
                  checked={hasFreeDay}
                  onCheckedChange={(v) => setHasFreeDay(!!v)}
                />
                <Label htmlFor="freeDay">Hat freien Tag</Label>
              </div>
              {hasFreeDay && (
                <div className="pl-6 flex gap-3 flex-wrap">
                  {WEEKDAYS.map((wd) => (
                    <label key={wd.value} className="flex items-center gap-1.5 cursor-pointer">
                      <Checkbox
                        checked={freeDays.includes(wd.value)}
                        onCheckedChange={() => toggleFreeDay(wd.value)}
                      />
                      <span className="text-sm">{wd.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Hat freie Stunden */}
            <div className="space-y-2 p-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="freeSlots"
                  checked={hasFreeSlots}
                  onCheckedChange={(v) => setHasFreeSlots(!!v)}
                />
                <Label htmlFor="freeSlots">Hat freie Stunden</Label>
              </div>
              {hasFreeSlots && (
                <div className="pl-6 flex gap-3 flex-wrap">
                  {[1, 2, 3, 4, 5, 6].map((slot) => (
                    <label key={slot} className="flex items-center gap-1.5 cursor-pointer">
                      <Checkbox
                        checked={freeSlots.includes(slot)}
                        onCheckedChange={() => toggleFreeSlot(slot)}
                      />
                      <span className="text-sm">{slot}. Std</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

          </div>

          <AllowedSubjectSelect
            subjects={subjects}
            classes={classes}
            allowed={allowedSubjects}
            onChange={setAllowedSubjects}
          />
          <ForbiddenSubjectSelect
            subjects={subjects}
            selected={forbiddenSubjectIds}
            onChange={setForbiddenSubjectIds}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Abbrechen
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid || saving}>
            {saving ? "Speichern..." : "Speichern"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
