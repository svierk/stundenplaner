import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SubjectForm } from "@/components/subjects/subject-form";
import { useSubjectStore } from "@/stores/subject-store";
import { useClassStore } from "@/stores/class-store";
import { useToast } from "@/hooks/use-toast";
import { SortHeader } from "@/components/ui/sort-header";
import { SUBJECT_CATEGORIES } from "@/types";
import type { Subject } from "@/types";

function CategoryBadge({ category }: { category: import("@/types").SubjectCategory }) {
  const label = SUBJECT_CATEGORIES.find((c) => c.value === category)?.label ?? category;
  const styles: Record<string, string> = {
    main:     "bg-blue-100 text-blue-800 border-blue-200",
    minor:    "bg-gray-100 text-gray-700 border-gray-200",
    activity: "bg-purple-100 text-purple-800 border-purple-200",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${styles[category] ?? styles.minor}`}>
      {label}
    </span>
  );
}

export function SubjectsPage() {
  const { subjects, loading, fetch, create, update, remove } = useSubjectStore();
  const { classes, fetch: fetchClasses } = useClassStore();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Subject | undefined>();
  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const handleSort = (key: string) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const sorted = [...subjects].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortKey) {
      case "name":     return a.name.localeCompare(b.name) * dir;
      case "grades":   return (a.grade_configs.length - b.grade_configs.length) * dir;
      case "category": return a.category.localeCompare(b.category) * dir;
      default:         return 0;
    }
  });

  useEffect(() => {
    fetch();
    fetchClasses();
  }, [fetch, fetchClasses]);

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
                <SortHeader label="Fach"          sortKey="name"     currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                <SortHeader label="Klassenstufen" sortKey="grades"   currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                <SortHeader label="Kategorie"     sortKey="category" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                <th className="p-3 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((subject) => (
                <tr key={subject.id} className="border-t hover:bg-blue-50/60 transition-colors cursor-default">
                  <td className="p-3 font-medium">{subject.name}</td>
                  <td className="p-3">
                    <div className="flex gap-1 flex-wrap">
                      {subject.grade_configs.map((gc) => (
                        <Badge key={gc.grade_level} variant="secondary">
                          Kl. {gc.grade_level}
                          {gc.category_override && (
                            <span className="ml-1 opacity-60">
                              ({SUBJECT_CATEGORIES.find((c) => c.value === gc.category_override)?.label})
                            </span>
                          )}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="p-3">
                    <CategoryBadge category={subject.category} />
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
        allSubjects={subjects}
        allClasses={classes}
      />
    </div>
  );
}
