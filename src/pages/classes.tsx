import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClassForm } from "@/components/classes/class-form";
import { useClassStore } from "@/stores/class-store";
import { useSubjectStore } from "@/stores/subject-store";
import { useToast } from "@/hooks/use-toast";
import type { SchoolClass } from "@/types";

export function ClassesPage() {
  const { classes, loading, fetch, create, update, remove } = useClassStore();
  const { subjects, fetch: fetchSubjects } = useSubjectStore();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SchoolClass | undefined>();

  useEffect(() => {
    fetch();
    fetchSubjects();
  }, [fetch, fetchSubjects]);

  const handleCreate = async (data: Parameters<typeof create>[0]) => {
    try {
      await create(data);
      toast({ title: "Klasse erstellt" });
    } catch (err) {
      toast({ variant: "destructive", title: "Fehler beim Erstellen", description: String(err) });
      throw err;
    }
  };

  const handleUpdate = async (data: Parameters<typeof create>[0]) => {
    if (!editing) return;
    try {
      await update(editing.id, data);
      toast({ title: "Klasse aktualisiert" });
      setEditing(undefined);
    } catch (err) {
      toast({ variant: "destructive", title: "Fehler beim Speichern", description: String(err) });
      throw err;
    }
  };

  const handleDelete = async (cls: SchoolClass) => {
    if (!confirm(`Klasse "${cls.name}" wirklich löschen?`)) return;
    try {
      await remove(cls.id);
      toast({ title: "Klasse gelöscht" });
    } catch (err) {
      toast({ variant: "destructive", title: "Fehler beim Löschen", description: String(err) });
    }
  };

  const openEdit = (cls: SchoolClass) => {
    setEditing(cls);
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
          <h1 className="text-2xl font-bold tracking-tight">Klassen</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Schulklassen konfigurieren und verwalten
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          Neue Klasse
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
          Laden...
        </div>
      ) : classes.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-3 text-gray-400 border border-gray-200 rounded-lg bg-white">
          <GraduationCap className="h-8 w-8 opacity-30" />
          <p className="text-sm">Noch keine Klassen angelegt</p>
          <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            Erste Klasse anlegen
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 overflow-hidden bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left p-3 font-medium">Klasse</th>
                <th className="text-left p-3 font-medium">Stufe</th>
                <th className="text-left p-3 font-medium">Std/Wo</th>
                <th className="text-left p-3 font-medium">Max/Tag</th>
                <th className="text-left p-3 font-medium">Freistunden</th>
                <th className="text-left p-3 font-medium">Fächer</th>
                <th className="p-3 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {classes.map((cls) => (
                <tr key={cls.id} className="border-t hover:bg-blue-50/60 transition-colors cursor-default">
                  <td className="p-3 font-medium">{cls.name}</td>
                  <td className="p-3">
                    <Badge variant="secondary">Klasse {cls.grade_level}</Badge>
                  </td>
                  <td className="p-3 text-muted-foreground">{cls.hours_per_week}</td>
                  <td className="p-3 text-muted-foreground">{cls.max_hours_per_day}</td>
                  <td className="p-3 text-muted-foreground">
                    {cls.allow_free_periods ? "Ja" : "Nein"}
                  </td>
                  <td className="p-3">
                    <div className="flex gap-1 flex-wrap">
                      {cls.subjects.slice(0, 4).map((s) => (
                        <Badge key={s.subject_id} variant="outline" className="text-xs">
                          {s.subject_name ?? s.subject_id} ({s.hours_per_week}h)
                        </Badge>
                      ))}
                      {cls.subjects.length > 4 && (
                        <Badge variant="outline" className="text-xs">
                          +{cls.subjects.length - 4}
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="p-3">
                    <div className="flex gap-1 justify-end">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(cls)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(cls)}>
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

      <ClassForm
        key={editing?.id ?? "new"}
        open={dialogOpen}
        onClose={closeDialog}
        onSubmit={editing ? handleUpdate : handleCreate}
        initial={editing}
        subjects={subjects}
      />
    </div>
  );
}
