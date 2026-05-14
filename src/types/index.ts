export type Weekday = 1 | 2 | 3 | 4 | 5;

export const WEEKDAYS: { value: Weekday; label: string; short: string }[] = [
  { value: 1, label: "Montag", short: "Mo" },
  { value: 2, label: "Dienstag", short: "Di" },
  { value: 3, label: "Mittwoch", short: "Mi" },
  { value: 4, label: "Donnerstag", short: "Do" },
  { value: 5, label: "Freitag", short: "Fr" },
];

export const GRADE_LEVELS = [1, 2, 3, 4] as const;
export type GradeLevel = (typeof GRADE_LEVELS)[number];

export const MAX_SLOTS_PER_DAY = 6;

// ─── Subjects ────────────────────────────────────────────────────────────────

export type SubjectCategory = "main" | "minor" | "activity";

export const SUBJECT_CATEGORIES: { value: SubjectCategory; label: string }[] = [
  { value: "main", label: "Hauptfach" },
  { value: "minor", label: "Nebenfach" },
  { value: "activity", label: "AG" },
];

export interface SubjectGradeConfig {
  id?: number;
  subject_id: number;
  grade_level: GradeLevel;
  hours_per_week: number;
  category_override?: SubjectCategory;
}

export interface Subject {
  id: number;
  name: string;
  created_at: string;
  category: SubjectCategory;
  grade_configs: SubjectGradeConfig[];
  allowed_days: Weekday[];
  allowed_slots: number[];
  no_double_periods: boolean;
  no_double_staffing: boolean;
  no_repeat_per_day: boolean;
  must_be_boundary: boolean;
  no_parallel_classes: boolean;
  no_parallel_subject_ids: number[];
  // Parallel scheduling (Cases 1–3):
  // coupled_class_ids: these classes share this subject simultaneously with the same teacher (Cases 2 & 3)
  // parallel_partner_subject_ids: subjects that must be co-scheduled at the same slot per class (Cases 1 & 3)
  coupled_class_ids: number[];
  parallel_partner_subject_ids: number[];
}

export interface SubjectFormData {
  name: string;
  category: SubjectCategory;
  grade_configs: { grade_level: GradeLevel; hours_per_week: number; category_override?: SubjectCategory }[];
  allowed_days: Weekday[];
  allowed_slots: number[];
  no_double_periods: boolean;
  no_double_staffing: boolean;
  no_repeat_per_day: boolean;
  must_be_boundary: boolean;
  no_parallel_classes: boolean;
  no_parallel_subject_ids: number[];
  coupled_class_ids: number[];
  parallel_partner_subject_ids: number[];
}

// ─── Teachers ─────────────────────────────────────────────────────────────────

export interface AllowedSubjectEntry {
  subject_id: number;
  class_ids: number[]; // empty = unrestricted (any class)
}

export interface Teacher {
  id: number;
  first_name: string;
  last_name: string;
  abbreviation: string;
  hours_per_week: number;
  is_class_teacher: boolean;
  has_free_day: boolean;
  free_days: Weekday[];
  own_class_id: number | null;
  own_class_name?: string;
  created_at: string;
  allowed_subjects: AllowedSubjectEntry[];
  forbidden_subject_ids: number[];
  additional_duty_name: string | null;
  additional_duty_hours: number;
  has_free_slots: boolean;
  free_slots: number[];
}

export interface TeacherFormData {
  first_name: string;
  last_name: string;
  abbreviation: string;
  hours_per_week: number;
  is_class_teacher: boolean;
  has_free_day: boolean;
  free_days: Weekday[];
  own_class_id: number | null;
  allowed_subjects: AllowedSubjectEntry[];
  forbidden_subject_ids: number[];
  additional_duty_name: string | null;
  additional_duty_hours: number;
  has_free_slots: boolean;
  free_slots: number[];
}

// ─── Grade level config ───────────────────────────────────────────────────────

export interface GradeLevelConfig {
  grade_level: GradeLevel;
  min_hours_per_day: number;
  max_hours_per_day: number;
}

// ─── Classes ──────────────────────────────────────────────────────────────────

export interface SchoolClass {
  id: number;
  name: string;
  grade_level: GradeLevel;
  allow_free_periods: boolean;
  created_at: string;
}

export interface ClassFormData {
  name: string;
  grade_level: GradeLevel;
  allow_free_periods: boolean;
}

// ─── Timetable ────────────────────────────────────────────────────────────────

export interface TimetableEntry {
  id: number;
  timetable_id: number;
  class_id: number;
  class_name?: string;
  subject_id: number;
  subject_name?: string;
  teacher_id: number;
  teacher_abbreviation?: string;
  teacher_name?: string;
  day: Weekday;
  slot: number;
  is_double_staffed: boolean;
  second_teacher_id?: number;
  second_teacher_abbreviation?: string;
  second_teacher_name?: string;
}

export interface Timetable {
  id: number;
  name: string;
  generated_at: string;
  school_year: string;
  warnings: string[];
  entries: TimetableEntry[];
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

export interface SchedulerInput {
  teachers: Teacher[];
  classes: SchoolClass[];
  subjects: Subject[];
}

export interface SchedulerResult {
  timetable: Omit<Timetable, "id" | "entries">;
  entries: Omit<TimetableEntry, "id" | "timetable_id">[];
  warnings: string[];
}
