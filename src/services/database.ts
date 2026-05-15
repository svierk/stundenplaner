import Database from "@tauri-apps/plugin-sql";
import type {
  Subject,
  Teacher,
  SchoolClass,
  Weekday,
  SubjectFormData,
  TeacherFormData,
  ClassFormData,
  GradeLevelConfig,
  Timetable,
  TimetableEntry,
  GradeLevel,
  AllowedSubjectEntry,
  SubjectCategory,
} from "@/types";

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load("sqlite:stundenplaner.db");
    // Ensure schema additions from later migrations exist even when the Rust binary
    // hasn't been recompiled yet (e.g. after a frontend-only hot-reload).
    await db.execute(`CREATE TABLE IF NOT EXISTS subject_no_parallel_with (
      subject_id       INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      other_subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      PRIMARY KEY (subject_id, other_subject_id)
    )`);
    // Classes that share a subject simultaneously with the same teacher (Cases 2 & 3)
    await db.execute(`CREATE TABLE IF NOT EXISTS subject_coupled_classes (
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      class_id   INTEGER NOT NULL REFERENCES classes(id)   ON DELETE CASCADE,
      PRIMARY KEY (subject_id, class_id)
    )`);
    // Bidirectional partner-subject link: both (A,B) and (B,A) are stored (Cases 1 & 3)
    await db.execute(`CREATE TABLE IF NOT EXISTS subject_parallel_partner (
      subject_id         INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      partner_subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      PRIMARY KEY (subject_id, partner_subject_id)
    )`);
    // Classes for which this subject does not take place (e.g. Kath. Religion for 2a, 3a, 4a)
    await db.execute(`CREATE TABLE IF NOT EXISTS subject_excluded_classes (
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      class_id   INTEGER NOT NULL REFERENCES classes(id)  ON DELETE CASCADE,
      PRIMARY KEY (subject_id, class_id)
    )`);
    // ALTER TABLE doesn't support IF NOT EXISTS in SQLite; catch the benign "duplicate column" error.
    try {
      await db.execute("ALTER TABLE subjects ADD COLUMN no_double_staffing INTEGER NOT NULL DEFAULT 0");
    } catch { /* column already exists */ }
    try {
      await db.execute("ALTER TABLE subjects ADD COLUMN no_repeat_per_day INTEGER NOT NULL DEFAULT 0");
    } catch { /* column already exists */ }
    try {
      await db.execute("ALTER TABLE subjects ADD COLUMN must_be_boundary INTEGER NOT NULL DEFAULT 0");
    } catch { /* column already exists */ }
    try {
      await db.execute("ALTER TABLE timetables ADD COLUMN warnings TEXT NOT NULL DEFAULT '[]'");
    } catch { /* column already exists */ }
    try {
      await db.execute("ALTER TABLE subjects ADD COLUMN category TEXT NOT NULL DEFAULT 'minor'");
    } catch { /* column already exists */ }
    try {
      await db.execute("ALTER TABLE subject_grade_configs ADD COLUMN category_override TEXT");
    } catch { /* column already exists */ }
  }
  return db;
}

// ─── Subjects ────────────────────────────────────────────────────────────────

type SubjectRow = { id: number; name: string; created_at: string; category: string; no_double_periods: number; no_double_staffing: number; no_repeat_per_day: number; must_be_boundary: number; no_parallel_classes: number };
type GradeConfigRow = {
  id: number;
  subject_id: number;
  grade_level: number;
  hours_per_week: number;
  category_override: string | null;
};
type DayRow = { subject_id: number; day: number };
type SlotRow = { subject_id: number; slot: number };
type NoParallelRow = { subject_id: number; other_subject_id: number };
type CoupledClassRow = { subject_id: number; class_id: number };
type ExcludedClassRow = { subject_id: number; class_id: number };
type ParallelPartnerRow = { subject_id: number; partner_subject_id: number };

export async function getSubjects(): Promise<Subject[]> {
  const db = await getDb();
  const rows = await db.select<SubjectRow[]>("SELECT * FROM subjects ORDER BY name");
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];

  const gradeConfigs = await db.select<GradeConfigRow[]>(
    `SELECT * FROM subject_grade_configs WHERE subject_id IN (${ids.join(",")})`,
  );
  const allowedDays = await db.select<DayRow[]>(
    `SELECT * FROM subject_allowed_days WHERE subject_id IN (${ids.join(",")})`,
  );
  const allowedSlots = await db.select<SlotRow[]>(
    `SELECT * FROM subject_allowed_slots WHERE subject_id IN (${ids.join(",")})`,
  );
  // Fetch both directions so either subject's form shows the link
  const noParallelWith = await db.select<NoParallelRow[]>(
    `SELECT * FROM subject_no_parallel_with
     WHERE subject_id IN (${ids.join(",")}) OR other_subject_id IN (${ids.join(",")})`,
  );
  const coupledClasses = await db.select<CoupledClassRow[]>(
    `SELECT * FROM subject_coupled_classes WHERE subject_id IN (${ids.join(",")})`,
  );
  const excludedClasses = await db.select<ExcludedClassRow[]>(
    `SELECT * FROM subject_excluded_classes WHERE subject_id IN (${ids.join(",")})`,
  );
  // Fetch both directions so both subjects in a partnership show the link
  const parallelPartners = await db.select<ParallelPartnerRow[]>(
    `SELECT * FROM subject_parallel_partner
     WHERE subject_id IN (${ids.join(",")}) OR partner_subject_id IN (${ids.join(",")})`,
  );

  return rows.map((r) => {
    // Collect all partner subject IDs from both directions
    const partnerSubjectIds = Array.from(new Set([
      ...parallelPartners.filter((p) => p.subject_id === r.id).map((p) => p.partner_subject_id),
      ...parallelPartners.filter((p) => p.partner_subject_id === r.id).map((p) => p.subject_id),
    ]));

    return {
      id: r.id,
      name: r.name,
      created_at: r.created_at,
      category: (r.category ?? "minor") as SubjectCategory,
      no_double_periods: r.no_double_periods === 1,
      no_double_staffing: r.no_double_staffing === 1,
      no_repeat_per_day: r.no_repeat_per_day === 1,
      must_be_boundary: r.must_be_boundary === 1,
      no_parallel_classes: r.no_parallel_classes === 1,
      no_parallel_subject_ids: Array.from(new Set([
        ...noParallelWith.filter((n) => n.subject_id === r.id).map((n) => n.other_subject_id),
        ...noParallelWith.filter((n) => n.other_subject_id === r.id).map((n) => n.subject_id),
      ])),
      coupled_class_ids: coupledClasses
        .filter((c) => c.subject_id === r.id)
        .map((c) => c.class_id),
      excluded_class_ids: excludedClasses
        .filter((e) => e.subject_id === r.id)
        .map((e) => e.class_id),
      parallel_partner_subject_ids: partnerSubjectIds,
      grade_configs: gradeConfigs
        .filter((g) => g.subject_id === r.id)
        .map((g) => ({
          ...g,
          grade_level: g.grade_level as GradeLevel,
          hours_per_week: g.hours_per_week,
          category_override: g.category_override ? g.category_override as SubjectCategory : undefined,
        })),
      allowed_days: allowedDays
        .filter((d) => d.subject_id === r.id)
        .map((d) => d.day as Weekday)
        .sort(),
      allowed_slots: allowedSlots
        .filter((s) => s.subject_id === r.id)
        .map((s) => s.slot)
        .sort((a, b) => a - b),
    };
  });
}

export async function createSubject(data: SubjectFormData): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    "INSERT INTO subjects (name, category, no_double_periods, no_double_staffing, no_repeat_per_day, must_be_boundary, no_parallel_classes) VALUES (?,?,?,?,?,?,?)",
    [data.name, data.category, data.no_double_periods ? 1 : 0, data.no_double_staffing ? 1 : 0, data.no_repeat_per_day ? 1 : 0, data.must_be_boundary ? 1 : 0, data.no_parallel_classes ? 1 : 0],
  );
  const id = result.lastInsertId as number;
  await _saveSubjectRelations(db, id, data);
  return id;
}

export async function updateSubject(id: number, data: SubjectFormData): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE subjects SET name = ?, category = ?, no_double_periods = ?, no_double_staffing = ?, no_repeat_per_day = ?, must_be_boundary = ?, no_parallel_classes = ? WHERE id = ?",
    [data.name, data.category, data.no_double_periods ? 1 : 0, data.no_double_staffing ? 1 : 0, data.no_repeat_per_day ? 1 : 0, data.must_be_boundary ? 1 : 0, data.no_parallel_classes ? 1 : 0, id],
  );
  await db.execute("DELETE FROM subject_grade_configs WHERE subject_id = ?", [id]);
  await db.execute("DELETE FROM subject_allowed_days WHERE subject_id = ?", [id]);
  await db.execute("DELETE FROM subject_allowed_slots WHERE subject_id = ?", [id]);
  await db.execute(
    "DELETE FROM subject_no_parallel_with WHERE subject_id = ? OR other_subject_id = ?",
    [id, id],
  );
  await db.execute("DELETE FROM subject_coupled_classes WHERE subject_id = ?", [id]);
  await db.execute("DELETE FROM subject_excluded_classes WHERE subject_id = ?", [id]);
  await db.execute(
    "DELETE FROM subject_parallel_partner WHERE subject_id = ? OR partner_subject_id = ?",
    [id, id],
  );
  await _saveSubjectRelations(db, id, data);
}

export async function deleteSubject(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM subjects WHERE id = ?", [id]);
}

async function _saveSubjectRelations(db: Database, id: number, data: SubjectFormData) {
  for (const gc of data.grade_configs) {
    await db.execute(
      "INSERT INTO subject_grade_configs (subject_id, grade_level, hours_per_week, category_override) VALUES (?,?,?,?)",
      [id, gc.grade_level, gc.hours_per_week, gc.category_override ?? null],
    );
  }
  for (const day of data.allowed_days) {
    await db.execute("INSERT INTO subject_allowed_days (subject_id, day) VALUES (?,?)", [id, day]);
  }
  for (const slot of data.allowed_slots) {
    await db.execute("INSERT INTO subject_allowed_slots (subject_id, slot) VALUES (?,?)", [
      id,
      slot,
    ]);
  }
  for (const otherId of data.no_parallel_subject_ids) {
    // Store both directions so either subject's form shows the link
    await db.execute(
      "INSERT OR IGNORE INTO subject_no_parallel_with (subject_id, other_subject_id) VALUES (?,?)",
      [id, otherId],
    );
    await db.execute(
      "INSERT OR IGNORE INTO subject_no_parallel_with (subject_id, other_subject_id) VALUES (?,?)",
      [otherId, id],
    );
  }
  for (const classId of data.coupled_class_ids) {
    await db.execute(
      "INSERT OR IGNORE INTO subject_coupled_classes (subject_id, class_id) VALUES (?,?)",
      [id, classId],
    );
  }
  for (const classId of data.excluded_class_ids) {
    await db.execute(
      "INSERT OR IGNORE INTO subject_excluded_classes (subject_id, class_id) VALUES (?,?)",
      [id, classId],
    );
  }
  for (const partnerId of data.parallel_partner_subject_ids) {
    // Store both directions so both subjects' forms show the link
    await db.execute(
      "INSERT OR IGNORE INTO subject_parallel_partner (subject_id, partner_subject_id) VALUES (?,?)",
      [id, partnerId],
    );
    await db.execute(
      "INSERT OR IGNORE INTO subject_parallel_partner (subject_id, partner_subject_id) VALUES (?,?)",
      [partnerId, id],
    );
  }
}

// ─── Teachers ─────────────────────────────────────────────────────────────────

type TeacherRow = {
  id: number;
  first_name: string;
  last_name: string;
  abbreviation: string;
  hours_per_week: number;
  is_class_teacher: number;
  has_free_day: number;
  free_days: string;
  own_class_id: number | null;
  own_class_name: string | null;
  created_at: string;
  additional_duty_name: string | null;
  additional_duty_hours: number;
  has_free_slots: number;
  free_slots: string;
};
type TeacherSubjectRow = { teacher_id: number; subject_id: number };
type TeacherSubjectClassRow = { teacher_id: number; subject_id: number; class_id: number };

export async function getTeachers(): Promise<Teacher[]> {
  const db = await getDb();
  const rows = await db.select<TeacherRow[]>(
    `SELECT t.*, c.name as own_class_name
     FROM teachers t
     LEFT JOIN classes c ON c.id = t.own_class_id
     ORDER BY t.last_name, t.first_name`,
  );
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];

  const allowedSubjects = await db.select<TeacherSubjectRow[]>(
    `SELECT * FROM teacher_allowed_subjects WHERE teacher_id IN (${ids.join(",")})`,
  );
  const allowedSubjectClasses = await db.select<TeacherSubjectClassRow[]>(
    `SELECT * FROM teacher_allowed_subject_classes WHERE teacher_id IN (${ids.join(",")})`,
  );
  const forbiddenSubjects = await db.select<TeacherSubjectRow[]>(
    `SELECT * FROM teacher_forbidden_subjects WHERE teacher_id IN (${ids.join(",")})`,
  );

  return rows.map((r) => ({
    id: r.id,
    first_name: r.first_name,
    last_name: r.last_name,
    abbreviation: r.abbreviation,
    hours_per_week: r.hours_per_week,
    is_class_teacher: r.is_class_teacher === 1,
    has_free_day: r.has_free_day === 1,
    free_days: (JSON.parse(r.free_days) as number[]).map((d) => d as Weekday),
    own_class_id: r.own_class_id,
    own_class_name: r.own_class_name ?? undefined,
    created_at: r.created_at,
    allowed_subjects: allowedSubjects
      .filter((s) => s.teacher_id === r.id)
      .map((s): AllowedSubjectEntry => ({
        subject_id: s.subject_id,
        class_ids: allowedSubjectClasses
          .filter((c) => c.teacher_id === r.id && c.subject_id === s.subject_id)
          .map((c) => c.class_id),
      })),
    forbidden_subject_ids: forbiddenSubjects
      .filter((s) => s.teacher_id === r.id)
      .map((s) => s.subject_id),
    additional_duty_name: r.additional_duty_name,
    additional_duty_hours: r.additional_duty_hours ?? 0,
    has_free_slots: r.has_free_slots === 1,
    free_slots: (JSON.parse(r.free_slots ?? "[]") as number[]),
  }));
}

export async function createTeacher(data: TeacherFormData): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO teachers (first_name, last_name, abbreviation, hours_per_week,
     is_class_teacher, has_free_day, free_days, own_class_id,
     additional_duty_name, additional_duty_hours, has_free_slots, free_slots)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      data.first_name,
      data.last_name,
      data.abbreviation,
      data.hours_per_week,
      data.is_class_teacher ? 1 : 0,
      data.has_free_day ? 1 : 0,
      JSON.stringify(data.free_days),
      data.own_class_id,
      data.additional_duty_name,
      data.additional_duty_hours,
      data.has_free_slots ? 1 : 0,
      JSON.stringify(data.free_slots),
    ],
  );
  const id = result.lastInsertId as number;
  await _saveTeacherSubjects(db, id, data);
  return id;
}

export async function updateTeacher(id: number, data: TeacherFormData): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE teachers SET first_name=?, last_name=?, abbreviation=?, hours_per_week=?,
     is_class_teacher=?, has_free_day=?, free_days=?, own_class_id=?,
     additional_duty_name=?, additional_duty_hours=?, has_free_slots=?, free_slots=? WHERE id=?`,
    [
      data.first_name,
      data.last_name,
      data.abbreviation,
      data.hours_per_week,
      data.is_class_teacher ? 1 : 0,
      data.has_free_day ? 1 : 0,
      JSON.stringify(data.free_days),
      data.own_class_id,
      data.additional_duty_name,
      data.additional_duty_hours,
      data.has_free_slots ? 1 : 0,
      JSON.stringify(data.free_slots),
      id,
    ],
  );
  await db.execute("DELETE FROM teacher_allowed_subjects WHERE teacher_id = ?", [id]);
  await db.execute("DELETE FROM teacher_allowed_subject_classes WHERE teacher_id = ?", [id]);
  await db.execute("DELETE FROM teacher_forbidden_subjects WHERE teacher_id = ?", [id]);
  await _saveTeacherSubjects(db, id, data);
}

export async function deleteTeacher(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM teachers WHERE id = ?", [id]);
}

async function _saveTeacherSubjects(db: Database, id: number, data: TeacherFormData) {
  for (const entry of data.allowed_subjects) {
    await db.execute(
      "INSERT INTO teacher_allowed_subjects (teacher_id, subject_id) VALUES (?,?)",
      [id, entry.subject_id],
    );
    for (const classId of entry.class_ids) {
      await db.execute(
        "INSERT INTO teacher_allowed_subject_classes (teacher_id, subject_id, class_id) VALUES (?,?,?)",
        [id, entry.subject_id, classId],
      );
    }
  }
  for (const sid of data.forbidden_subject_ids) {
    await db.execute(
      "INSERT INTO teacher_forbidden_subjects (teacher_id, subject_id) VALUES (?,?)",
      [id, sid],
    );
  }
}

// ─── Grade level configs ──────────────────────────────────────────────────────

type GradeLevelConfigRow = {
  grade_level: number;
  min_hours_per_day: number;
  max_hours_per_day: number;
};

export async function getGradeLevelConfigs(): Promise<GradeLevelConfig[]> {
  const db = await getDb();
  const rows = await db.select<GradeLevelConfigRow[]>(
    "SELECT * FROM grade_level_configs ORDER BY grade_level",
  );
  return rows.map((r) => ({
    grade_level: r.grade_level as GradeLevel,
    min_hours_per_day: r.min_hours_per_day,
    max_hours_per_day: r.max_hours_per_day,
  }));
}

export async function upsertGradeLevelConfig(cfg: GradeLevelConfig): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO grade_level_configs (grade_level, min_hours_per_day, max_hours_per_day)
     VALUES (?, ?, ?)
     ON CONFLICT(grade_level) DO UPDATE SET
       min_hours_per_day = excluded.min_hours_per_day,
       max_hours_per_day = excluded.max_hours_per_day`,
    [cfg.grade_level, cfg.min_hours_per_day, cfg.max_hours_per_day],
  );
}

// ─── Classes ──────────────────────────────────────────────────────────────────

type ClassRow = {
  id: number;
  name: string;
  grade_level: number;
  allow_free_periods: number;
  created_at: string;
};

export async function getClasses(): Promise<SchoolClass[]> {
  const db = await getDb();
  const rows = await db.select<ClassRow[]>("SELECT * FROM classes ORDER BY grade_level, name");
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    grade_level: r.grade_level as GradeLevel,
    allow_free_periods: r.allow_free_periods === 1,
    created_at: r.created_at,
  }));
}

export async function createClass(data: ClassFormData): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO classes (name, grade_level, allow_free_periods) VALUES (?,?,?)`,
    [data.name, data.grade_level, data.allow_free_periods ? 1 : 0],
  );
  return result.lastInsertId as number;
}

export async function updateClass(id: number, data: ClassFormData): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE classes SET name=?, grade_level=?, allow_free_periods=? WHERE id=?`,
    [data.name, data.grade_level, data.allow_free_periods ? 1 : 0, id],
  );
}

export async function deleteClass(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM classes WHERE id = ?", [id]);
}

// ─── Timetables ───────────────────────────────────────────────────────────────

type TimetableRow = { id: number; name: string; generated_at: string; school_year: string; warnings: string };
type EntryRow = {
  id: number;
  timetable_id: number;
  class_id: number;
  class_name: string;
  subject_id: number;
  subject_name: string;
  teacher_id: number;
  teacher_abbreviation: string;
  teacher_last_name: string;
  teacher_first_name: string;
  day: number;
  slot: number;
  is_double_staffed: number;
  second_teacher_id: number | null;
  second_teacher_abbreviation: string | null;
  second_teacher_last_name: string | null;
  second_teacher_first_name: string | null;
};

export async function getTimetables(): Promise<Timetable[]> {
  const db = await getDb();
  const rows = await db.select<TimetableRow[]>(
    "SELECT * FROM timetables ORDER BY generated_at DESC",
  );
  const result: Timetable[] = [];
  for (const row of rows) {
    const entries = await getTimetableEntries(row.id);
    result.push({ ...row, warnings: JSON.parse(row.warnings ?? "[]") as string[], entries });
  }
  return result;
}

export async function getTimetableEntries(timetableId: number): Promise<TimetableEntry[]> {
  const db = await getDb();
  const rows = await db.select<EntryRow[]>(
    `SELECT e.*,
       c.name as class_name,
       s.name as subject_name,
       t.abbreviation as teacher_abbreviation,
       t.last_name as teacher_last_name,
       t.first_name as teacher_first_name,
       tds.teacher_id as second_teacher_id,
       t2.abbreviation as second_teacher_abbreviation,
       t2.last_name as second_teacher_last_name,
       t2.first_name as second_teacher_first_name
     FROM timetable_entries e
     JOIN classes c ON c.id = e.class_id
     JOIN subjects s ON s.id = e.subject_id
     JOIN teachers t ON t.id = e.teacher_id
     LEFT JOIN timetable_double_staff tds ON tds.entry_id = e.id
     LEFT JOIN teachers t2 ON t2.id = tds.teacher_id
     WHERE e.timetable_id = ?
     ORDER BY e.class_id, e.day, e.slot`,
    [timetableId],
  );

  return rows.map((r) => ({
    id: r.id,
    timetable_id: r.timetable_id,
    class_id: r.class_id,
    class_name: r.class_name,
    subject_id: r.subject_id,
    subject_name: r.subject_name,
    teacher_id: r.teacher_id,
    teacher_abbreviation: r.teacher_abbreviation,
    teacher_name: `${r.teacher_first_name} ${r.teacher_last_name}`,
    day: r.day as Weekday,
    slot: r.slot,
    is_double_staffed: r.is_double_staffed === 1,
    second_teacher_id: r.second_teacher_id ?? undefined,
    second_teacher_abbreviation: r.second_teacher_abbreviation ?? undefined,
    second_teacher_name: r.second_teacher_last_name
      ? `${r.second_teacher_first_name} ${r.second_teacher_last_name}`
      : undefined,
  }));
}

export async function saveTimetable(
  name: string,
  schoolYear: string,
  entries: Omit<TimetableEntry, "id" | "timetable_id">[],
  warnings: string[] = [],
): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    "INSERT INTO timetables (name, school_year, warnings) VALUES (?,?,?)",
    [name, schoolYear, JSON.stringify(warnings)],
  );
  const timetableId = result.lastInsertId as number;
  for (const entry of entries) {
    const entryResult = await db.execute(
      `INSERT INTO timetable_entries
       (timetable_id, class_id, subject_id, teacher_id, day, slot, is_double_staffed)
       VALUES (?,?,?,?,?,?,?)`,
      [
        timetableId,
        entry.class_id,
        entry.subject_id,
        entry.teacher_id,
        entry.day,
        entry.slot,
        entry.is_double_staffed ? 1 : 0,
      ],
    );
    if (entry.second_teacher_id) {
      await db.execute(
        "INSERT INTO timetable_double_staff (entry_id, teacher_id) VALUES (?,?)",
        [entryResult.lastInsertId as number, entry.second_teacher_id],
      );
    }
  }
  return timetableId;
}

export async function deleteTimetable(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM timetables WHERE id = ?", [id]);
}

export async function deleteTimetables(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDb();
  const placeholders = ids.map(() => "?").join(", ");
  await db.execute(`DELETE FROM timetables WHERE id IN (${placeholders})`, ids);
}

export async function swapTimetableEntries(idA: number, idB: number): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ id: number; day: number; slot: number }[]>(
    "SELECT id, day, slot FROM timetable_entries WHERE id IN (?, ?)",
    [idA, idB],
  );
  if (rows.length !== 2) throw new Error(`Einträge ${idA} und ${idB} nicht gefunden`);
  const a = rows.find((r) => r.id === idA)!;
  const b = rows.find((r) => r.id === idB)!;

  // Read double-staffing for both entries before swapping
  const dsRows = await db.select<{ entry_id: number; teacher_id: number }[]>(
    "SELECT entry_id, teacher_id FROM timetable_double_staff WHERE entry_id IN (?, ?)",
    [idA, idB],
  );
  const dsA = dsRows.filter((r) => r.entry_id === idA).map((r) => r.teacher_id);
  const dsB = dsRows.filter((r) => r.entry_id === idB).map((r) => r.teacher_id);

  // Swap day/slot
  await db.execute("UPDATE timetable_entries SET day=?, slot=? WHERE id=?", [b.day, b.slot, idA]);
  await db.execute("UPDATE timetable_entries SET day=?, slot=? WHERE id=?", [a.day, a.slot, idB]);

  // Swap double-staffing so it stays at its original slot position:
  // Entry A moves to B's old slot → A gets B's double-staffing teachers
  // Entry B moves to A's old slot → B gets A's double-staffing teachers
  await db.execute("DELETE FROM timetable_double_staff WHERE entry_id IN (?, ?)", [idA, idB]);
  for (const tid of dsB) {
    await db.execute("INSERT INTO timetable_double_staff (entry_id, teacher_id) VALUES (?, ?)", [idA, tid]);
  }
  for (const tid of dsA) {
    await db.execute("INSERT INTO timetable_double_staff (entry_id, teacher_id) VALUES (?, ?)", [idB, tid]);
  }
  await db.execute("UPDATE timetable_entries SET is_double_staffed=? WHERE id=?", [dsB.length > 0 ? 1 : 0, idA]);
  await db.execute("UPDATE timetable_entries SET is_double_staffed=? WHERE id=?", [dsA.length > 0 ? 1 : 0, idB]);
}
