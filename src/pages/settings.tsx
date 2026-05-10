import { useEffect, useState } from "react";
import { Download, Upload, Database, AlertTriangle, Clock } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useGradeLevelStore } from "@/stores/grade-level-store";
import { useToast } from "@/hooks/use-toast";
import { GRADE_LEVELS } from "@/types";
import type { GradeLevelConfig } from "@/types";

export function SettingsPage() {
  const { toast } = useToast();
  const { configs, fetch: fetchConfigs, upsert } = useGradeLevelStore();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [localConfigs, setLocalConfigs] = useState<GradeLevelConfig[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  useEffect(() => {
    if (configs.length > 0) setLocalConfigs(configs);
  }, [configs]);

  const updateLocal = (grade: number, field: "min_hours_per_day" | "max_hours_per_day", value: number) => {
    setLocalConfigs((prev) =>
      prev.map((c) => (c.grade_level === grade ? { ...c, [field]: value } : c)),
    );
  };

  const handleSaveConfigs = async () => {
    setSaving(true);
    try {
      for (const cfg of localConfigs) {
        await upsert(cfg);
      }
      toast({ title: "Klassenstufen gespeichert" });
    } catch (err) {
      toast({ variant: "destructive", title: "Fehler beim Speichern", description: String(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    const dest = await save({
      defaultPath: "stundenplaner-backup.db",
      filters: [{ name: "SQLite Datenbank", extensions: ["db"] }],
    });
    if (!dest) return;
    setExporting(true);
    try {
      await invoke("export_database", { destPath: dest });
      toast({ title: "Export erfolgreich", description: `Gespeichert unter: ${dest}` });
    } catch (err) {
      toast({ variant: "destructive", title: "Export fehlgeschlagen", description: String(err) });
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "SQLite Datenbank", extensions: ["db"] }],
    });
    if (!selected) return;
    if (!confirm("Achtung: Der Import überschreibt alle aktuellen Daten. Möchten Sie fortfahren?"))
      return;
    setImporting(true);
    try {
      await invoke("import_database", { srcPath: selected });
      toast({
        title: "Import erfolgreich",
        description: "Bitte starten Sie die App neu, damit alle Änderungen wirksam werden.",
      });
    } catch (err) {
      toast({ variant: "destructive", title: "Import fehlgeschlagen", description: String(err) });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Einstellungen</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Klassenstufen-Konfiguration, Datenbankeinstellungen und Import/Export
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Unterrichtsstunden pro Klassenstufe
          </CardTitle>
          <CardDescription>
            Legt fest, wie viele Unterrichtsstunden pro Tag je Klassenstufe mindestens und
            höchstens eingeplant werden dürfen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left p-2 font-medium">Klassenstufe</th>
                  <th className="text-left p-2 font-medium">Min. Std/Tag</th>
                  <th className="text-left p-2 font-medium">Max. Std/Tag</th>
                </tr>
              </thead>
              <tbody>
                {GRADE_LEVELS.map((grade) => {
                  const cfg = localConfigs.find((c) => c.grade_level === grade);
                  return (
                    <tr key={grade} className="border-t">
                      <td className="p-2 font-medium">Klasse {grade}</td>
                      <td className="p-2">
                        <Input
                          type="number"
                          min={1}
                          max={10}
                          value={cfg?.min_hours_per_day ?? ""}
                          onChange={(e) => updateLocal(grade, "min_hours_per_day", Number(e.target.value))}
                          className="w-20"
                          disabled={!cfg}
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          min={1}
                          max={10}
                          value={cfg?.max_hours_per_day ?? ""}
                          onChange={(e) => updateLocal(grade, "max_hours_per_day", Number(e.target.value))}
                          className="w-20"
                          disabled={!cfg}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Button onClick={handleSaveConfigs} disabled={saving || localConfigs.length === 0}>
            {saving ? "Speichern..." : "Speichern"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            Datenbank
          </CardTitle>
          <CardDescription>
            Die Datenbank wird lokal auf Ihrem Gerät gespeichert. Erstellen Sie regelmäßig
            Backups.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <Button onClick={handleExport} disabled={exporting} variant="outline">
              <Download className="h-4 w-4" />
              {exporting ? "Exportieren..." : "Datenbank exportieren"}
            </Button>
            <Button onClick={handleImport} disabled={importing} variant="outline">
              <Upload className="h-4 w-4" />
              {importing ? "Importieren..." : "Datenbank importieren"}
            </Button>
          </div>
          <div className="flex gap-2 rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <p>
              Der Import überschreibt alle vorhandenen Daten unwiderruflich. Sichern Sie die
              aktuelle Datenbank vor dem Import.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Über die App</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>
            <strong>Stundenplaner</strong> – Dynamischer Stundenplan-Generator für Grundschulen
          </p>
          <p>Version: 0.1.0</p>
          <p>Läuft vollständig lokal, ohne Cloud- oder Netzwerkabhängigkeiten.</p>
        </CardContent>
      </Card>
    </div>
  );
}
