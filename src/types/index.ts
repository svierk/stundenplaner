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

export interface SubjectGradeConfig {
  id?: number;
  subject_id: number;
  grade_level: GradeLevel;
  hours_per_week: number;
}

export interface Subject {
  id: number;
  name: string;
  created_at: string;
  grade_configs: SubjectGradeConfig[];
  allowed_days: Weekday[];
  allowed_slots: number[];
  no_double_periods: boolean;
  no_parallel_classes: boolean;
}

export interface SubjectFormData {
  name: string;
  grade_configs: { grade_level: GradeLevel; hours_per_week: number }[];
  allowed_days: Weekday[];
  allowed_slots: number[];
  no_double_periods: boolean;
  no_parallel_classes: boolean;
}

// ─── Teachers ─────────────────────────────────────────────────────────────────

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
  core_subject_ids: number[];
  allowed_subject_ids: number[];
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
  core_subject_ids: number[];
  allowed_subject_ids: number[];
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
