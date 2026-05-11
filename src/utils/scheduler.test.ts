import { describe, it, expect } from "vitest";
import { generateTimetable } from "./scheduler";
import type { Teacher, SchoolClass, Subject, GradeLevelConfig, AllowedSubjectEntry } from "@/types";

const defaultGradeLevelConfigs: GradeLevelConfig[] = [
  { grade_level: 1, min_hours_per_day: 4, max_hours_per_day: 6 },
  { grade_level: 2, min_hours_per_day: 4, max_hours_per_day: 6 },
  { grade_level: 3, min_hours_per_day: 5, max_hours_per_day: 6 },
  { grade_level: 4, min_hours_per_day: 5, max_hours_per_day: 6 },
];

const makeSubject = (id: number, name: string, gradeLevel: 1 | 2 | 3 | 4 = 1): Subject => ({
  id,
  name,
  created_at: "",
  category: "minor",
  grade_configs: [{ id, subject_id: id, grade_level: gradeLevel, hours_per_week: 4 }],
  allowed_days: [],
  allowed_slots: [],
  no_double_periods: false,
  no_double_staffing: false,
  no_parallel_classes: false,
  no_parallel_subject_ids: [],
});

const makeTeacher = (id: number, allowedSubjectIds: number[]): Teacher => ({
  id,
  first_name: `Teacher${id}`,
  last_name: `Last${id}`,
  abbreviation: `T${id}`,
  hours_per_week: 28,
  is_class_teacher: false,
  has_free_day: false,
  free_days: [],
  own_class_id: null,
  created_at: "",
  allowed_subjects: allowedSubjectIds.map((sid): AllowedSubjectEntry => ({ subject_id: sid, class_ids: [] })),
  forbidden_subject_ids: [],
  additional_duty_name: null,
  additional_duty_hours: 0,
  has_free_slots: false,
  free_slots: [],
});

const makeClass = (id: number, gradeLevel: 1 | 2 | 3 | 4 = 1): SchoolClass => ({
  id,
  name: `${gradeLevel}a`,
  grade_level: gradeLevel,
  allow_free_periods: false,
  created_at: "",
});

describe("generateTimetable", () => {
  it("returns entries for each class-subject combination", () => {
    const subjects = [makeSubject(1, "Deutsch"), makeSubject(2, "Mathe")];
    const teachers = [makeTeacher(1, [1, 2])];
    const classes = [makeClass(1)];

    const result = generateTimetable(teachers, classes, subjects, defaultGradeLevelConfigs);
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries.every((e) => e.class_id === 1)).toBe(true);
  });

  it("respects teacher capacity", () => {
    const subjects = [makeSubject(1, "Deutsch")];
    subjects[0].grade_configs[0].hours_per_week = 10;
    const teachers = [makeTeacher(1, [1])];
    teachers[0].hours_per_week = 5;
    const classes = [makeClass(1)];

    const result = generateTimetable(teachers, classes, subjects, defaultGradeLevelConfigs);
    const assignedToTeacher = result.entries.filter((e) => e.teacher_id === 1).length;
    expect(assignedToTeacher).toBeLessThanOrEqual(5);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("does not assign a teacher on their free day", () => {
    const subjects = [makeSubject(1, "Deutsch")];
    const teachers = [makeTeacher(1, [1])];
    teachers[0].has_free_day = true;
    teachers[0].free_days = [1]; // Monday free

    const classes = [makeClass(1)];

    const result = generateTimetable(teachers, classes, subjects, defaultGradeLevelConfigs);
    const mondayEntries = result.entries.filter((e) => e.day === 1 && e.teacher_id === 1);
    expect(mondayEntries.length).toBe(0);
  });

  it("does not assign a forbidden subject", () => {
    const subjects = [makeSubject(1, "Deutsch"), makeSubject(2, "Sport")];
    const teachers = [makeTeacher(1, [1])];
    teachers[0].forbidden_subject_ids = [2];

    const classes = [makeClass(1)];

    const result = generateTimetable(teachers, classes, subjects, defaultGradeLevelConfigs);
    const sportAssignedToT1 = result.entries.filter(
      (e) => e.teacher_id === 1 && e.subject_id === 2,
    );
    expect(sportAssignedToT1.length).toBe(0);
  });

  it("respects max hours per day constraint", () => {
    const subjects = [makeSubject(1, "Deutsch")];
    subjects[0].grade_configs[0].hours_per_week = 8;
    const teachers = [makeTeacher(1, [1])];
    const classes = [makeClass(1)];
    const configs: GradeLevelConfig[] = [{ grade_level: 1, min_hours_per_day: 1, max_hours_per_day: 2 }];

    const result = generateTimetable(teachers, classes, subjects, configs);
    const byDay = new Map<number, number>();
    for (const e of result.entries.filter((e) => e.class_id === 1)) {
      byDay.set(e.day, (byDay.get(e.day) ?? 0) + 1);
    }
    for (const [, count] of byDay) {
      expect(count).toBeLessThanOrEqual(2);
    }
  });

  it("does not produce gaps when allow_free_periods is false", () => {
    const subjects = [makeSubject(1, "Deutsch"), makeSubject(2, "Mathe"), makeSubject(3, "Sport")];
    subjects[0].grade_configs[0].hours_per_week = 2;
    subjects[1].grade_configs[0].hours_per_week = 2;
    subjects[2].grade_configs[0].hours_per_week = 2;
    const teachers = [makeTeacher(1, [1, 2, 3])];
    const classes = [makeClass(1)];
    classes[0].allow_free_periods = false;

    const result = generateTimetable(teachers, classes, subjects, defaultGradeLevelConfigs);

    // Slots on each day must form a contiguous range starting from 1 (no gaps)
    const byDay = new Map<number, number[]>();
    for (const e of result.entries.filter((e) => e.class_id === 1)) {
      if (!byDay.has(e.day)) byDay.set(e.day, []);
      byDay.get(e.day)!.push(e.slot);
    }
    for (const [, slots] of byDay) {
      const sorted = slots.sort((a, b) => a - b);
      expect(sorted[0]).toBe(1);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]).toBe(sorted[i - 1] + 1);
      }
    }
  });

  it("does not assign a second teacher to a class+subject that already has one", () => {
    const subjects = [makeSubject(1, "Deutsch")];
    subjects[0].grade_configs[0].hours_per_week = 4;
    const teachers = [makeTeacher(1, [1]), makeTeacher(2, [1])];
    const classes = [makeClass(1)];

    const result = generateTimetable(teachers, classes, subjects, defaultGradeLevelConfigs);
    const teacherIds = new Set(result.entries.map((e) => e.teacher_id));
    expect(teacherIds.size).toBe(1);
  });

  it("returns empty entries for no input", () => {
    const result = generateTimetable([], [], [], []);
    expect(result.entries.length).toBe(0);
    expect(result.warnings.length).toBe(0);
  });

  it("returns warnings when no teacher is available for a subject", () => {
    const subjects = [makeSubject(1, "Musik")];
    const teachers = [makeTeacher(1, [99])];
    teachers[0].forbidden_subject_ids = [1]; // explicitly cannot teach Musik
    const classes = [makeClass(1)];

    const result = generateTimetable(teachers, classes, subjects, defaultGradeLevelConfigs);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("prefers explicitly allowed teacher over fallback", () => {
    const subjects = [makeSubject(1, "Deutsch")];
    subjects[0].grade_configs[0].hours_per_week = 2;
    // Teacher 1: fallback only (not in allowed, not forbidden)
    const t1 = makeTeacher(1, []);
    // Teacher 2: explicitly allowed for subject 1
    const t2 = makeTeacher(2, [1]);
    const classes = [makeClass(1)];

    const result = generateTimetable([t1, t2], classes, subjects, defaultGradeLevelConfigs);
    const usedTeacherIds = new Set(result.entries.map((e) => e.teacher_id));
    // Allowed teacher (2) should be the one locked in
    expect(usedTeacherIds.has(2)).toBe(true);
    expect(usedTeacherIds.size).toBe(1);
  });

  it("falls back to non-forbidden teacher when no explicit match is available", () => {
    const subjects = [makeSubject(1, "Kunst")];
    subjects[0].grade_configs[0].hours_per_week = 2;
    // Teacher with no explicit subject config, but not forbidden either
    const t1 = makeTeacher(1, []);
    const classes = [makeClass(1)];

    const result = generateTimetable([t1], classes, subjects, defaultGradeLevelConfigs);
    // Should still schedule lessons using the fallback teacher
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries.every((e) => e.teacher_id === 1)).toBe(true);
  });

  it("distributes lessons across all weekdays with no empty days when total hours allow it", () => {
    // 5 subjects × 4h/week = 20h total = 5 days × min(4)/day for grade 1
    // allow_free_periods = true so subjects can use non-consecutive slots and avoid double-period cascades
    const subjects = [
      makeSubject(1, "Deutsch"),
      makeSubject(2, "Mathe"),
      makeSubject(3, "Sport"),
      makeSubject(4, "Sachkunde"),
      makeSubject(5, "Musik"),
    ];
    const teachers = [makeTeacher(1, [1, 2, 3, 4, 5])];
    teachers[0].hours_per_week = 40;
    const classes = [makeClass(1)];
    classes[0].allow_free_periods = true;

    const result = generateTimetable(teachers, classes, subjects, defaultGradeLevelConfigs);

    const daysWithLessons = new Set(result.entries.filter((e) => e.class_id === 1).map((e) => e.day));
    expect(daysWithLessons.size).toBe(5);
    expect(result.warnings.some((w) => w.includes("1a") && w.includes("Minimum"))).toBe(false);
  });

  it("allows at most two consecutive hours of the same subject per class per day", () => {
    const subjects = [makeSubject(1, "Deutsch")];
    subjects[0].grade_configs[0].hours_per_week = 5; // forces spread across days
    const teachers = [makeTeacher(1, [1])];
    const classes = [makeClass(1)];
    classes[0].allow_free_periods = true;

    const result = generateTimetable(teachers, classes, subjects, defaultGradeLevelConfigs);

    // For each day, the subject must not appear 3+ times in a row
    const byDay = new Map<number, number[]>();
    for (const e of result.entries) {
      if (!byDay.has(e.day)) byDay.set(e.day, []);
      byDay.get(e.day)!.push(e.slot);
    }
    for (const [, slots] of byDay) {
      const sorted = slots.sort((a, b) => a - b);
      let consecutive = 1;
      for (let i = 1; i < sorted.length; i++) {
        consecutive = sorted[i] === sorted[i - 1] + 1 ? consecutive + 1 : 1;
        expect(consecutive).toBeLessThanOrEqual(2);
      }
    }
  });

  it("does not schedule the same subject in two classes at the same day+slot when no_parallel_classes is true", () => {
    const subject = makeSubject(1, "Musik");
    subject.grade_configs = [
      { id: 1, subject_id: 1, grade_level: 1, hours_per_week: 3 },
      { id: 2, subject_id: 1, grade_level: 2, hours_per_week: 3 },
    ];
    subject.no_parallel_classes = true;
    const teachers = [makeTeacher(1, [1])];
    teachers[0].hours_per_week = 40;
    const classes = [makeClass(1, 1), makeClass(2, 2)];
    classes[0].allow_free_periods = true;
    classes[1].allow_free_periods = true;

    const result = generateTimetable(teachers, classes, [subject], defaultGradeLevelConfigs);

    // No two entries for subject 1 may share the same day+slot
    const usedSlots = new Set<string>();
    for (const e of result.entries.filter((e) => e.subject_id === 1)) {
      const key = `${e.day}-${e.slot}`;
      expect(usedSlots.has(key)).toBe(false);
      usedSlots.add(key);
    }
  });

  it("prevents any back-to-back hours when no_double_periods is true", () => {
    const subjects = [makeSubject(1, "Sport")];
    subjects[0].grade_configs[0].hours_per_week = 4;
    subjects[0].no_double_periods = true;
    const teachers = [makeTeacher(1, [1])];
    const classes = [makeClass(1)];
    classes[0].allow_free_periods = true;

    const result = generateTimetable(teachers, classes, subjects, defaultGradeLevelConfigs);

    const byDay = new Map<number, number[]>();
    for (const e of result.entries) {
      if (!byDay.has(e.day)) byDay.set(e.day, []);
      byDay.get(e.day)!.push(e.slot);
    }
    for (const [, slots] of byDay) {
      const sorted = slots.sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]).not.toBe(sorted[i - 1] + 1);
      }
    }
  });
});
