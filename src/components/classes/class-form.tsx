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
import type { SchoolClass, ClassFormData, GradeLevel } from "@/types";
import { GRADE_LEVELS } from "@/types";

interface ClassFormProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: ClassFormData) => Promise<void>;
  initial?: SchoolClass;
}

export function ClassForm({ open, onClose, onSubmit, initial }: ClassFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [gradeLevel, setGradeLevel] = useState<GradeLevel>(initial?.grade_level ?? 1);
  const [allowFreePeriods, setAllowFreePeriods] = useState(initial?.allow_free_periods ?? false);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        grade_level: gradeLevel,
        allow_free_periods: allowFreePeriods,
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
      <DialogContent className="max-w-md">
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
                onValueChange={(v) => setGradeLevel(Number(v) as GradeLevel)}
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

          <div className="flex items-center gap-2">
            <Checkbox
              id="freePeriods"
              checked={allowFreePeriods}
              onCheckedChange={(v) => setAllowFreePeriods(!!v)}
            />
            <Label htmlFor="freePeriods">Freistunden erlauben</Label>
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
