import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SubjectForm } from "@/components/subjects/subject-form";
import { useSubjectStore } from "@/stores/subject-store";
import { useToast } from "@/hooks/use-toast";
import { WEEKDAYS } from "@/types";
import type { Subject } from "@/types";

export function SubjectsPage() {
  const { subjects, loading, fetch, create, update, remove } = useSubjectStore();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Subject | undefined>();

  useEffect(() => {
    fetch();
  }, [fetch]);

  const handleCreate = async (data: Parameters<typeof create>[0]) => {
    try {
      await create(data);
      toast({ title: "Fach erstellt" });
    } catch (err) {
      toast({ variant: "destructive", title: "Fehler beim Erstellen", description: String(err) });
      throw err;
    }
  };

  const handleUpdate = async (data: Parameters<typeof create>[0]) => {
    if (!editing) return;
    try {
      await update(editing.id, data);
      toast({ title: "Fach aktualisiert" });
      setEditing(undefined);
    } catch (err) {
      toast({ variant: "destructive", title: "Fehler beim Speichern", description: String(err) });
      throw err;
    }
  };

  const handleDelete = async (subject: Subject) => {
    if (!confirm(`Fach "${subject.name}" wirklich löschen?`)) return;
    try {
      await remove(subject.id);
      toast({ title: "Fach gelöscht" });
    } catch (err) {
      toast({ variant: "destructive", title: "Fehler beim Löschen", description: String(err) });
    }
  };

  const openEdit = (subject: Subject) => {
    setEditing(subject);
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(undefined);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Fächer</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Schulfächer konfigurieren und verwalten
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          Neues Fach
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
          Laden...
        </div>
      ) : subjects.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-3 text-gray-400 border border-gray-200 rounded-lg bg-white">
          <BookOpen className="h-8 w-8 opacity-30" />
          <p className="text-sm">Noch keine Fächer angelegt</p>
          <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            Erstes Fach anlegen
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 overflow-hidden bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left p-3 font-medium">Fach</th>
                <th className="text-left p-3 font-medium">Klassenstufen</th>
                <th className="text-left p-3 font-medium">Std/Woche</th>
                <th className="text-left p-3 font-medium">Tage</th>
                <th className="text-left p-3 font-medium">Stunden</th>
                <th className="p-3 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {subjects.map((subject) => (
                <tr key={subject.id} className="border-t hover:bg-blue-50/60 transition-colors cursor-default">
                  <td className="p-3 font-medium">{subject.name}</td>
                  <td className="p-3">
                    <div className="flex gap-1 flex-wrap">
                      {subject.grade_configs.map((gc) => (
                        <Badge key={gc.grade_level} variant="secondary">
                          Kl. {gc.grade_level}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {subject.grade_configs.length > 0
                      ? subject.grade_configs
                          .map((gc) => `${gc.min_hours_per_week}–${gc.max_hours_per_week}`)
                          .join(", ")
                      : "–"}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {subject.allowed_days.length === 5
                      ? "Alle"
                      : subject.allowed_days
                          .map((d) => WEEKDAYS.find((w) => w.value === d)?.short)
                          .join(", ")}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {subject.allowed_slots.length === 0
                      ? "Alle"
                      : subject.allowed_slots.map((s) => `${s}.`).join(", ")}
                  </td>
                  <td className="p-3">
                    <div className="flex gap-1 justify-end">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(subject)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(subject)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SubjectForm
        key={editing?.id ?? "new"}
        open={dialogOpen}
        onClose={closeDialog}
        onSubmit={editing ? handleUpdate : handleCreate}
        initial={editing}
      />
    </div>
  );
}
