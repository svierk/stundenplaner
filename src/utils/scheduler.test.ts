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
  no_repeat_per_day: false,
  must_be_boundary: false,
  no_parallel_classes: false,
  no_parallel_subject_ids: [],
  coupled_class_ids: [],
  parallel_partner_subject_ids: [],
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
      // First slot is 1 or 2 (stagger offset), sequence must be contiguous with no gaps
      expect(sorted[0]).toBeGreaterThanOrEqual(1);
      expect(sorted[0]).toBeLessThanOrEqual(2);
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

  it("places a coupled group with restricted day+slot even when other subjects are processed first", () => {
    // Regression: a coupled subject restricted to Thursday+slot1 must appear in ALL classes'
    // timetables even when other less-constrained subjects have fewer eligible teachers.
    const religion = makeSubject(1, "Religion");
    religion.grade_configs = [
      { id: 1, subject_id: 1, grade_level: 1, hours_per_week: 1 },
      { id: 2, subject_id: 1, grade_level: 2, hours_per_week: 1 },
    ];
    religion.allowed_days = [4]; // Thursday only
    religion.allowed_slots = [1]; // slot 1 only
    religion.coupled_class_ids = [1, 2, 3]; // all three classes coupled

    const deutsch = makeSubject(2, "Deutsch");
    deutsch.grade_configs = [
      { id: 3, subject_id: 2, grade_level: 1, hours_per_week: 4 },
      { id: 4, subject_id: 2, grade_level: 2, hours_per_week: 4 },
    ];

    // Teacher 1 can only teach Deutsch (fewer eligible → sorted earlier in old logic)
    const t1 = makeTeacher(1, [2]);
    t1.hours_per_week = 40;
    // Teacher 2 can teach both
    const t2 = makeTeacher(2, [1, 2]);
    t2.hours_per_week = 40;

    const classes = [makeClass(1, 1), makeClass(2, 1), makeClass(3, 2)];

    const result = generateTimetable([t1, t2], classes, [religion, deutsch], defaultGradeLevelConfigs);

    // All three classes must have Religion scheduled
    for (const cls of classes) {
      const religionEntries = result.entries.filter(
        (e) => e.class_id === cls.id && e.subject_id === 1,
      );
      expect(religionEntries.length).toBe(1);
      expect(religionEntries[0].day).toBe(4);
      expect(religionEntries[0].slot).toBe(1);
    }
    // All three must share the same teacher (coupled group)
    const teacherIds = new Set(result.entries.filter((e) => e.subject_id === 1).map((e) => e.teacher_id));
    expect(teacherIds.size).toBe(1);
  });

  it("places slot-restricted subject at slot 1 even when designated subjects already occupy higher slots on that day", () => {
    // Regression: real-world case where Kath. Religion (slot 1, Thursday only, all classes coupled)
    // fails because class-teacher designations fill Thursday slots 2..N first. The prepend fix
    // must allow Religion to slip into slot 1 (adjacent → still contiguous, no gap).
    const religion = makeSubject(1, "Religion");
    religion.grade_configs = [{ id: 1, subject_id: 1, grade_level: 1, hours_per_week: 1 }];
    religion.allowed_days = [4]; // Thursday only
    religion.allowed_slots = [1]; // slot 1 only
    religion.coupled_class_ids = [1, 2]; // both classes coupled

    const deutsch = makeSubject(2, "Deutsch");
    deutsch.grade_configs = [{ id: 2, subject_id: 2, grade_level: 1, hours_per_week: 4 }];

    // Teacher 1: designated for Deutsch in class 1 → sorts before Religion due to designation
    const t1 = makeTeacher(1, []);
    t1.allowed_subjects = [{ subject_id: 2, class_ids: [1] }]; // designated = class-specific
    t1.hours_per_week = 40;
    // Teacher 2: teaches Religion (and can also teach Deutsch as fallback for class 2)
    const t2 = makeTeacher(2, [1]);
    t2.hours_per_week = 40;

    const classes = [makeClass(1, 1), makeClass(2, 1)];

    const result = generateTimetable([t1, t2], classes, [religion, deutsch], defaultGradeLevelConfigs);

    // Both classes must have Religion at Thursday slot 1 despite Deutsch filling slots 2+
    for (const cls of classes) {
      const rel = result.entries.filter((e) => e.class_id === cls.id && e.subject_id === 1);
      expect(rel.length).toBe(1);
      expect(rel[0].day).toBe(4); // Thursday
      expect(rel[0].slot).toBe(1); // slot 1
    }
    // All Religion entries share the same teacher (coupled group)
    const relTeachers = new Set(result.entries.filter((e) => e.subject_id === 1).map((e) => e.teacher_id));
    expect(relTeachers.size).toBe(1);
  });

  it("places coupled group with partner subject: each class gets own partner teacher at same slot", () => {
    // Scenario: LMS (id=2) coupled for classes 1a+1b+1c, must be parallel to Deutsch (id=1).
    // DB loads parallel_partner_subject_ids bidirectionally, so BOTH subjects reference each other.
    // LMS.id > Deutsch.id → old skip-logic dropped LMS (Deutsch drove, per-class, different teachers).
    // Fix: coupled subject always drives; its partner is allowed to process freely afterward.
    const deutsch = makeSubject(1, "Deutsch");
    deutsch.grade_configs = [{ id: 1, subject_id: 1, grade_level: 1, hours_per_week: 2 }];
    deutsch.parallel_partner_subject_ids = [2]; // bidirectional (as DB loads it)

    const lms = makeSubject(2, "LMS");
    lms.grade_configs = [{ id: 2, subject_id: 2, grade_level: 1, hours_per_week: 1 }];
    lms.coupled_class_ids = [1, 2, 3];
    lms.parallel_partner_subject_ids = [1]; // Deutsch (id=1 < id=2)

    // One LMS teacher
    const tLms = makeTeacher(10, [2]);
    tLms.hours_per_week = 28;

    // Three dedicated Deutsch teachers, one per class
    const tD1 = makeTeacher(11, []);
    tD1.allowed_subjects = [{ subject_id: 1, class_ids: [1] }];
    tD1.hours_per_week = 28;
    const tD2 = makeTeacher(12, []);
    tD2.allowed_subjects = [{ subject_id: 1, class_ids: [2] }];
    tD2.hours_per_week = 28;
    const tD3 = makeTeacher(13, []);
    tD3.allowed_subjects = [{ subject_id: 1, class_ids: [3] }];
    tD3.hours_per_week = 28;

    const cls1 = makeClass(1, 1);
    const cls2 = { ...makeClass(2, 1), name: "1b" };
    const cls3 = { ...makeClass(3, 1), name: "1c" };

    const result = generateTimetable(
      [tLms, tD1, tD2, tD3],
      [cls1, cls2, cls3],
      [deutsch, lms],
      defaultGradeLevelConfigs,
    );

    // LMS must appear for all three classes at the same (day, slot)
    const lmsEntries = result.entries.filter((e) => e.subject_id === 2);
    expect(lmsEntries.length).toBe(3);
    const lmsSlots = new Set(lmsEntries.map((e) => `${e.day}-${e.slot}`));
    expect(lmsSlots.size).toBe(1); // all at the same slot
    const lmsTeachers = new Set(lmsEntries.map((e) => e.teacher_id));
    expect(lmsTeachers.size).toBe(1); // same teacher for all

    // At that same slot, each class must have Deutsch with their own teacher
    const [[lmsDay, lmsSlot]] = [...lmsSlots].map((s) => s.split("-").map(Number));
    for (const cls of [cls1, cls2, cls3]) {
      const dEntry = result.entries.find(
        (e) => e.class_id === cls.id && e.subject_id === 1 && e.day === lmsDay && e.slot === lmsSlot,
      );
      expect(dEntry).toBeDefined();
      expect(dEntry!.teacher_id).not.toBe(tLms.id); // different from LMS teacher
    }
    // Each class must have a different Deutsch teacher at that slot
    const deutschTeachersAtSlot = result.entries
      .filter((e) => e.subject_id === 1 && e.day === lmsDay && e.slot === lmsSlot)
      .map((e) => e.teacher_id);
    expect(new Set(deutschTeachersAtSlot).size).toBe(3);
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
