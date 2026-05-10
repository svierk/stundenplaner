import * as XLSX from "xlsx";
import type { Timetable, SchoolClass, Teacher, Weekday } from "@/types";
import { WEEKDAYS } from "@/types";

const DAY_LABELS = WEEKDAYS.map((w) => w.label);

export function exportTimetableToExcel(
  timetable: Timetable,
  classes: SchoolClass[],
  teachers: Teacher[],
  _subjects: unknown,
): Uint8Array {
  const wb = XLSX.utils.book_new();

  // ── Sheet per class ──────────────────────────────────────────────────────
  for (const cls of classes) {
    const classEntries = timetable.entries.filter((e) => e.class_id === cls.id);
    if (classEntries.length === 0) continue;

    const maxSlot = classEntries.reduce((m, e) => Math.max(m, e.slot), 0);

    const headerRow = ["Stunde", ...DAY_LABELS];
    const dataRows: string[][] = [headerRow];

    for (let slot = 1; slot <= maxSlot; slot++) {
      const row: string[] = [`${slot}.`];
      for (const wd of [1, 2, 3, 4, 5] as Weekday[]) {
        const entry = classEntries.find((e) => e.day === wd && e.slot === slot);
        if (entry) {
          const doubleStr = entry.is_double_staffed ? " (+1)" : "";
          row.push(`${entry.subject_name}\n${entry.teacher_abbreviation}${doubleStr}`);
        } else {
          row.push("");
        }
      }
      dataRows.push(row);
    }

    const ws = XLSX.utils.aoa_to_sheet(dataRows);
    ws["!cols"] = [{ wch: 8 }, ...DAY_LABELS.map(() => ({ wch: 18 }))];
    XLSX.utils.book_append_sheet(wb, ws, `Klasse ${cls.name}`);
  }

  // ── Teacher overview sheet ────────────────────────────────────────────────
  const teacherRows: string[][] = [["Lehrer", "Kürzel", "Std/Wo geplant", "Std/Wo max", "Auslastung %"]];
  for (const teacher of teachers) {
    const assigned = timetable.entries.filter((e) => e.teacher_id === teacher.id).length;
    const pct = Math.round((assigned / teacher.hours_per_week) * 100);
    teacherRows.push([
      `${teacher.last_name}, ${teacher.first_name}`,
      teacher.abbreviation,
      assigned.toString(),
      teacher.hours_per_week.toString(),
      `${pct}%`,
    ]);
  }
  const teacherWs = XLSX.utils.aoa_to_sheet(teacherRows);
  teacherWs["!cols"] = [{ wch: 25 }, { wch: 8 }, { wch: 15 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, teacherWs, "Lehrer-Übersicht");

  // ── Teacher timetable sheet ───────────────────────────────────────────────
  for (const teacher of teachers) {
    const teacherEntries = timetable.entries.filter((e) => e.teacher_id === teacher.id);
    if (teacherEntries.length === 0) continue;

    const maxSlot = teacherEntries.reduce((m, e) => Math.max(m, e.slot), 0);

    const headerRow = ["Stunde", ...DAY_LABELS];
    const dataRows: string[][] = [headerRow];

    for (let slot = 1; slot <= maxSlot; slot++) {
      const row: string[] = [`${slot}.`];
      for (const wd of [1, 2, 3, 4, 5] as Weekday[]) {
        const entry = teacherEntries.find((e) => e.day === wd && e.slot === slot);
        if (entry) {
          row.push(`${entry.subject_name}\n${entry.class_name}`);
        } else {
          row.push("");
        }
      }
      dataRows.push(row);
    }

    const ws = XLSX.utils.aoa_to_sheet(dataRows);
    ws["!cols"] = [{ wch: 8 }, ...DAY_LABELS.map(() => ({ wch: 18 }))];
    const sheetName = teacher.abbreviation.slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Uint8Array(buffer);
}
