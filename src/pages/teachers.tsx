import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TeacherForm } from "@/components/teachers/teacher-form";
import { useTeacherStore } from "@/stores/teacher-store";
import { useSubjectStore } from "@/stores/subject-store";
import { useClassStore } from "@/stores/class-store";
import { useToast } from "@/hooks/use-toast";
import { SortHeader } from "@/components/ui/sort-header";
import { WEEKDAYS } from "@/types";
import type { Teacher } from "@/types";

export function TeachersPage() {
  const { teachers, loading, fetch, create, update, remove } = useTeacherStore();
  const { subjects, fetch: fetchSubjects } = useSubjectStore();
  const { classes, fetch: fetchClasses } = useClassStore();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Teacher | undefined>();

  useEffect(() => {
    fetch();
    fetchSubjects();
    fetchClasses();
  }, [fetch, fetchSubjects, fetchClasses]);

  const handleCreate = async (data: Parameters<typeof create>[0]) => {
    try {
      await create(data);
      toast({ title: "Lehrkraft erstellt" });
    } catch (err) {
      toast({ variant: "destructive", title: "Fehler beim Erstellen", description: String(err) });
      throw err;
    }
  };

  const handleUpdate = async (data: Parameters<typeof create>[0]) => {
    if (!editing) return;
    try {
      await update(editing.id, data);
      toast({ title: "Lehrkraft aktualisiert" });
      setEditing(undefined);
    } catch (err) {
      toast({ variant: "destructive", title: "Fehler beim Speichern", description: String(err) });
      throw err;
    }
  };

  const handleDelete = async (teacher: Teacher) => {
    if (!confirm(`Lehrkraft "${teacher.first_name} ${teacher.last_name}" wirklich löschen?`)) return;
    try {
      await remove(teacher.id);
      toast({ title: "Lehrkraft gelöscht" });
    } catch (err) {
      toast({ variant: "destructive", title: "Fehler beim Löschen", description: String(err) });
    }
  };

  const openEdit = (teacher: Teacher) => {
    setEditing(teacher);
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(undefined);
  };

  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const handleSort = (key: string) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const sorted = [...teachers].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortKey) {
      case "name":    return `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`) * dir;
      case "abbr":    return a.abbreviation.localeCompare(b.abbreviation) * dir;
      case "hours":   return (a.hours_per_week - b.hours_per_week) * dir;
      case "core":    return (a.allowed_subjects.length - b.allowed_subjects.length) * dir;
      case "freeDay": return ((a.has_free_day ? 1 : 0) - (b.has_free_day ? 1 : 0)) * dir;
      case "class":   return (a.own_class_name ?? "").localeCompare(b.own_class_name ?? "") * dir;
      case "duty":    return (a.additional_duty_name ?? "").localeCompare(b.additional_duty_name ?? "") * dir;
      default:        return 0;
    }
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Lehrkräfte</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Lehrkräfte konfigurieren und verwalten
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          Neue Lehrkraft
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
          Laden...
        </div>
      ) : teachers.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-3 text-gray-400 border border-gray-200 rounded-lg bg-white">
          <Users className="h-8 w-8 opacity-30" />
          <p className="text-sm">Noch keine Lehrkräfte angelegt</p>
          <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            Erste Lehrkraft anlegen
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 overflow-hidden bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <SortHeader label="Name"          sortKey="name"    currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                <SortHeader label="Kürzel"        sortKey="abbr"    currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                <SortHeader label="Klasse"        sortKey="class"   currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                <SortHeader label="Std/Wo"        sortKey="hours"   currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                <SortHeader label="Zusatzaufgabe" sortKey="duty"    currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                <SortHeader label="Freier Tag"    sortKey="freeDay" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                <th className="p-3 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((teacher) => (
                <tr key={teacher.id} className="border-t hover:bg-blue-50/60 transition-colors cursor-default">
                  <td className="p-3 font-medium">
                    {teacher.last_name}, {teacher.first_name}
                    {teacher.is_class_teacher && (
                      <Badge variant="outline" className="ml-2 text-xs">KL</Badge>
                    )}
                  </td>
                  <td className="p-3">
                    <Badge variant="secondary">{teacher.abbreviation}</Badge>
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {teacher.own_class_name ?? "–"}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {teacher.hours_per_week}h
                    {teacher.additional_duty_hours > 0 && (
                      <span className="ml-1">
                        ({teacher.hours_per_week - teacher.additional_duty_hours}h)
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {teacher.additional_duty_name
                      ? `${teacher.additional_duty_name} (${teacher.additional_duty_hours}h)`
                      : "–"}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {teacher.has_free_day
                      ? teacher.free_days
                          .map((d) => WEEKDAYS.find((w) => w.value === d)?.short)
                          .join(", ") || "Ja"
                      : "Nein"}
                  </td>
                  <td className="p-3">
                    <div className="flex gap-1 justify-end">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(teacher)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(teacher)}>
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

      <TeacherForm
        key={editing?.id ?? "new"}
        open={dialogOpen}
        onClose={closeDialog}
        onSubmit={editing ? handleUpdate : handleCreate}
        initial={editing}
        subjects={subjects}
        classes={classes}
      />
    </div>
  );
}
