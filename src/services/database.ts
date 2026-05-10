import Database from "@tauri-apps/plugin-sql";
import type {
  Subject,
  Teacher,
  SchoolClass,
  ClassSubject,
  Weekday,
  SubjectFormData,
  TeacherFormData,
  ClassFormData,
  Timetable,
  TimetableEntry,
  GradeLevel,
} from "@/types";

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load("sqlite:stundenplaner.db");
  }
  return db;
}

// ─── Subjects ────────────────────────────────────────────────────────────────

type SubjectRow = { id: number; name: string; created_at: string };
type GradeConfigRow = {
  id: number;
  subject_id: number;
  grade_level: number;
  hours_per_week: number;
};
type DayRow = { subject_id: number; day: number };
type SlotRow = { subject_id: number; slot: number };

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

  return rows.map((r) => ({
    ...r,
    grade_configs: gradeConfigs
      .filter((g) => g.subject_id === r.id)
      .map((g) => ({ ...g, grade_level: g.grade_level as GradeLevel, hours_per_week: g.hours_per_week })),
    allowed_days: allowedDays
      .filter((d) => d.subject_id === r.id)
      .map((d) => d.day as Weekday)
      .sort(),
    allowed_slots: allowedSlots
      .filter((s) => s.subject_id === r.id)
      .map((s) => s.slot)
      .sort((a, b) => a - b),
  }));
}

export async function createSubject(data: SubjectFormData): Promise<number> {
  const db = await getDb();
  const result = await db.execute("INSERT INTO subjects (name) VALUES (?)", [data.name]);
  const id = result.lastInsertId as number;
  await _saveSubjectRelations(db, id, data);
  return id;
}

export async function updateSubject(id: number, data: SubjectFormData): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE subjects SET name = ? WHERE id = ?", [data.name, id]);
  await db.execute("DELETE FROM subject_grade_configs WHERE subject_id = ?", [id]);
  await db.execute("DELETE FROM subject_allowed_days WHERE subject_id = ?", [id]);
  await db.execute("DELETE FROM subject_allowed_slots WHERE subject_id = ?", [id]);
  await _saveSubjectRelations(db, id, data);
}

export async function deleteSubject(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM subjects WHERE id = ?", [id]);
}

async function _saveSubjectRelations(db: Database, id: number, data: SubjectFormData) {
  for (const gc of data.grade_configs) {
    await db.execute(
      "INSERT INTO subject_grade_configs (subject_id, grade_level, hours_per_week) VALUES (?,?,?)",
      [id, gc.grade_level, gc.hours_per_week],
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
};
type TeacherSubjectRow = { teacher_id: number; subject_id: number };

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

  const coreSubjects = await db.select<TeacherSubjectRow[]>(
    `SELECT * FROM teacher_core_subjects WHERE teacher_id IN (${ids.join(",")})`,
  );
  const allowedSubjects = await db.select<TeacherSubjectRow[]>(
    `SELECT * FROM teacher_allowed_subjects WHERE teacher_id IN (${ids.join(",")})`,
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
    core_subject_ids: coreSubjects.filter((s) => s.teacher_id === r.id).map((s) => s.subject_id),
    allowed_subject_ids: allowedSubjects
      .filter((s) => s.teacher_id === r.id)
      .map((s) => s.subject_id),
    forbidden_subject_ids: forbiddenSubjects
      .filter((s) => s.teacher_id === r.id)
      .map((s) => s.subject_id),
  }));
}

export async function createTeacher(data: TeacherFormData): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO teachers (first_name, last_name, abbreviation, hours_per_week,
     is_class_teacher, has_free_day, free_days, own_class_id)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      data.first_name,
      data.last_name,
      data.abbreviation,
      data.hours_per_week,
      data.is_class_teacher ? 1 : 0,
      data.has_free_day ? 1 : 0,
      JSON.stringify(data.free_days),
      data.own_class_id,
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
     is_class_teacher=?, has_free_day=?, free_days=?, own_class_id=? WHERE id=?`,
    [
      data.first_name,
      data.last_name,
      data.abbreviation,
      data.hours_per_week,
      data.is_class_teacher ? 1 : 0,
      data.has_free_day ? 1 : 0,
      JSON.stringify(data.free_days),
      data.own_class_id,
      id,
    ],
  );
  await db.execute("DELETE FROM teacher_core_subjects WHERE teacher_id = ?", [id]);
  await db.execute("DELETE FROM teacher_allowed_subjects WHERE teacher_id = ?", [id]);
  await db.execute("DELETE FROM teacher_forbidden_subjects WHERE teacher_id = ?", [id]);
  await _saveTeacherSubjects(db, id, data);
}

export async function deleteTeacher(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM teachers WHERE id = ?", [id]);
}

async function _saveTeacherSubjects(db: Database, id: number, data: TeacherFormData) {
  for (const sid of data.core_subject_ids) {
    await db.execute("INSERT INTO teacher_core_subjects (teacher_id, subject_id) VALUES (?,?)", [
      id,
      sid,
    ]);
  }
  for (const sid of data.allowed_subject_ids) {
    await db.execute(
      "INSERT INTO teacher_allowed_subjects (teacher_id, subject_id) VALUES (?,?)",
      [id, sid],
    );
  }
  for (const sid of data.forbidden_subject_ids) {
    await db.execute(
      "INSERT INTO teacher_forbidden_subjects (teacher_id, subject_id) VALUES (?,?)",
      [id, sid],
    );
  }
}

// ─── Classes ──────────────────────────────────────────────────────────────────

type ClassRow = {
  id: number;
  name: string;
  grade_level: number;
  hours_per_week: number;
  max_hours_per_day: number;
  allow_free_periods: number;
  created_at: string;
};
type ClassSubjectRow = {
  class_id: number;
  subject_id: number;
  subject_name: string;
  hours_per_week: number;
};

export async function getClasses(): Promise<SchoolClass[]> {
  const db = await getDb();
  const rows = await db.select<ClassRow[]>("SELECT * FROM classes ORDER BY grade_level, name");
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];

  const classSubjects = await db.select<ClassSubjectRow[]>(
    `SELECT cs.*, s.name as subject_name
     FROM class_subjects cs
     JOIN subjects s ON s.id = cs.subject_id
     WHERE cs.class_id IN (${ids.join(",")})`,
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    grade_level: r.grade_level as GradeLevel,
    hours_per_week: r.hours_per_week,
    max_hours_per_day: r.max_hours_per_day,
    allow_free_periods: r.allow_free_periods === 1,
    created_at: r.created_at,
    subjects: classSubjects
      .filter((s) => s.class_id === r.id)
      .map((s) => ({
        subject_id: s.subject_id,
        subject_name: s.subject_name,
        hours_per_week: s.hours_per_week,
      })),
  }));
}

export async function createClass(data: ClassFormData): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO classes (name, grade_level, hours_per_week, max_hours_per_day, allow_free_periods)
     VALUES (?,?,?,?,?)`,
    [
      data.name,
      data.grade_level,
      data.hours_per_week,
      data.max_hours_per_day,
      data.allow_free_periods ? 1 : 0,
    ],
  );
  const id = result.lastInsertId as number;
  await _saveClassSubjects(db, id, data.subjects);
  return id;
}

export async function updateClass(id: number, data: ClassFormData): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE classes SET name=?, grade_level=?, hours_per_week=?, max_hours_per_day=?,
     allow_free_periods=? WHERE id=?`,
    [
      data.name,
      data.grade_level,
      data.hours_per_week,
      data.max_hours_per_day,
      data.allow_free_periods ? 1 : 0,
      id,
    ],
  );
  await db.execute("DELETE FROM class_subjects WHERE class_id = ?", [id]);
  await _saveClassSubjects(db, id, data.subjects);
}

export async function deleteClass(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM classes WHERE id = ?", [id]);
}

async function _saveClassSubjects(db: Database, id: number, subjects: ClassSubject[]) {
  for (const s of subjects) {
    await db.execute(
      "INSERT INTO class_subjects (class_id, subject_id, hours_per_week) VALUES (?,?,?)",
      [id, s.subject_id, s.hours_per_week],
    );
  }
}

// ─── Timetables ───────────────────────────────────────────────────────────────

type TimetableRow = { id: number; name: string; generated_at: string; school_year: string };
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
};

export async function getTimetables(): Promise<Timetable[]> {
  const db = await getDb();
  const rows = await db.select<TimetableRow[]>(
    "SELECT * FROM timetables ORDER BY generated_at DESC",
  );
  const result: Timetable[] = [];
  for (const row of rows) {
    const entries = await getTimetableEntries(row.id);
    result.push({ ...row, entries });
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
       t.first_name as teacher_first_name
     FROM timetable_entries e
     JOIN classes c ON c.id = e.class_id
     JOIN subjects s ON s.id = e.subject_id
     JOIN teachers t ON t.id = e.teacher_id
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
  }));
}

export async function saveTimetable(
  name: string,
  schoolYear: string,
  entries: Omit<TimetableEntry, "id" | "timetable_id">[],
): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    "INSERT INTO timetables (name, school_year) VALUES (?,?)",
    [name, schoolYear],
  );
  const timetableId = result.lastInsertId as number;
  for (const entry of entries) {
    await db.execute(
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
  }
  return timetableId;
}

export async function deleteTimetable(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM timetables WHERE id = ?", [id]);
}
