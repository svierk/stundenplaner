import { describe, it, expect } from "vitest";
import { generateTimetable } from "./scheduler";
import type { Teacher, SchoolClass, Subject, GradeLevelConfig } from "@/types";

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
  grade_configs: [{ id, subject_id: id, grade_level: gradeLevel, hours_per_week: 4 }],
  allowed_days: [],
  allowed_slots: [],
});

const makeTeacher = (id: number, coreSubjectIds: number[]): Teacher => ({
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
  core_subject_ids: coreSubjectIds,
  allowed_subject_ids: [],
  forbidden_subject_ids: [],
  additional_duty_name: null,
  additional_duty_hours: 0,
});

const makeClass = (id: number, subjectIds: number[], gradeLevel: 1 | 2 | 3 | 4 = 1): SchoolClass => ({
  id,
  name: `${gradeLevel}a`,
  grade_level: gradeLevel,
  allow_free_periods: false,
  created_at: "",
  subjects: subjectIds.map((sid) => ({ subject_id: sid, hours_per_week: 4 })),
});

describe("generateTimetable", () => {
  it("returns entries for each class-subject combination", () => {
    const subjects = [makeSubject(1, "Deutsch"), makeSubject(2, "Mathe")];
    const teachers = [makeTeacher(1, [1, 2])];
    const classes = [makeClass(1, [1, 2])];

    const result = generateTimetable(teachers, classes, subjects, defaultGradeLevelConfigs);
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries.every((e) => e.class_id === 1)).toBe(true);
  });

  it("respects teacher capacity", () => {
    const subjects = [makeSubject(1, "Deutsch")];
    const teachers = [makeTeacher(1, [1])];
    teachers[0].hours_per_week = 5;
    const classes = [makeClass(1, [1])];
    classes[0].subjects[0].hours_per_week = 10;

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

    const classes = [makeClass(1, [1])];

    const result = generateTimetable(teachers, classes, subjects, defaultGradeLevelConfigs);
    const mondayEntries = result.entries.filter((e) => e.day === 1 && e.teacher_id === 1);
    expect(mondayEntries.length).toBe(0);
  });

  it("does not assign a forbidden subject", () => {
    const subjects = [makeSubject(1, "Deutsch"), makeSubject(2, "Sport")];
    const teachers = [makeTeacher(1, [1])];
    teachers[0].forbidden_subject_ids = [2];

    const classes = [makeClass(1, [1, 2])];

    const result = generateTimetable(teachers, classes, subjects, defaultGradeLevelConfigs);
    const sportAssignedToT1 = result.entries.filter(
      (e) => e.teacher_id === 1 && e.subject_id === 2,
    );
    expect(sportAssignedToT1.length).toBe(0);
  });

  it("respects max hours per day constraint", () => {
    const subjects = [makeSubject(1, "Deutsch")];
    const teachers = [makeTeacher(1, [1])];
    const classes = [makeClass(1, [1])];
    classes[0].subjects[0].hours_per_week = 8;
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

  it("returns empty entries for no input", () => {
    const result = generateTimetable([], [], [], []);
    expect(result.entries.length).toBe(0);
    expect(result.warnings.length).toBe(0);
  });

  it("returns warnings when no teacher is available for a subject", () => {
    const subjects = [makeSubject(1, "Musik")];
    const teachers = [makeTeacher(1, [99])]; // teacher doesn't teach subject 1
    const classes = [makeClass(1, [1])];

    const result = generateTimetable(teachers, classes, subjects, defaultGradeLevelConfigs);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
