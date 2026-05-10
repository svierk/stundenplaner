import type {
  Teacher,
  SchoolClass,
  Subject,
  TimetableEntry,
  Weekday,
  SchedulerResult,
  GradeLevel,
} from "@/types";

interface SlotKey {
  day: Weekday;
  slot: number;
}

interface TeacherState {
  teacher: Teacher;
  assignedHours: number;
  busySlots: Set<string>;
}

interface ClassState {
  cls: SchoolClass;
  hoursAssigned: Map<number, number>; // subject_id -> hours assigned
  slotsPerDay: Map<Weekday, number>;  // day -> total slots used
  slots: Set<string>;
}

function slotKey(day: Weekday, slot: number): string {
  return `${day}-${slot}`;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function canTeachSubject(teacher: Teacher, subjectId: number): boolean {
  if (teacher.forbidden_subject_ids.includes(subjectId)) return false;
  return (
    teacher.core_subject_ids.includes(subjectId) ||
    teacher.allowed_subject_ids.includes(subjectId)
  );
}

function isTeacherAvailableOnDay(teacher: Teacher, day: Weekday): boolean {
  if (!teacher.has_free_day) return true;
  return !teacher.free_days.includes(day);
}

function getSubjectAllowedDays(subject: Subject): Weekday[] {
  return subject.allowed_days.length > 0
    ? subject.allowed_days
    : ([1, 2, 3, 4, 5] as Weekday[]);
}

function getSubjectAllowedSlots(subject: Subject, maxSlot: number): number[] {
  return subject.allowed_slots.length > 0
    ? subject.allowed_slots
    : Array.from({ length: maxSlot }, (_, i) => i + 1);
}

/**
 * Counts "free" (teaching-free) periods for a teacher across their working days.
 * A free period is a slot between their first and last slot of the day where they have no assignment.
 */
function countTeacherFreePeriods(teacherState: TeacherState): number {
  const byDay = new Map<Weekday, number[]>();
  for (const key of teacherState.busySlots) {
    const [d, s] = key.split("-").map(Number);
    const day = d as Weekday;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(s);
  }
  let freePeriods = 0;
  for (const [, slots] of byDay) {
    const sorted = [...slots].sort((a, b) => a - b);
    if (sorted.length < 2) continue;
    const range = sorted[sorted.length - 1] - sorted[0] + 1;
    freePeriods += range - sorted.length;
  }
  return freePeriods;
}

export function generateTimetable(
  teachers: Teacher[],
  classes: SchoolClass[],
  subjects: Subject[],
): SchedulerResult {
  const warnings: string[] = [];
  const entries: Omit<TimetableEntry, "id" | "timetable_id">[] = [];
  const MAX_SLOT = 8;

  const subjectMap = new Map(subjects.map((s) => [s.id, s]));

  const teacherStates = new Map<number, TeacherState>(
    teachers.map((t) => [
      t.id,
      { teacher: t, assignedHours: 0, busySlots: new Set() },
    ]),
  );

  const classStates = new Map<number, ClassState>(
    classes.map((c) => [
      c.id,
      {
        cls: c,
        hoursAssigned: new Map(),
        slotsPerDay: new Map(),
        slots: new Set(),
      },
    ]),
  );

  // Build list of all (class, subject, requiredHours) to schedule, sorted by most constrained first
  interface Assignment {
    cls: SchoolClass;
    subject: Subject;
    remaining: number;
    gradeLevel: GradeLevel;
  }

  const assignments: Assignment[] = [];
  for (const cls of classes) {
    for (const cs of cls.subjects) {
      const subject = subjectMap.get(cs.subject_id);
      if (!subject || cs.hours_per_week <= 0) continue;
      assignments.push({
        cls,
        subject,
        remaining: cs.hours_per_week,
        gradeLevel: cls.grade_level,
      });
    }
  }

  // Sort by most constrained (fewest eligible teachers, fewest days, then most hours)
  assignments.sort((a, b) => {
    const eligibleA = teachers.filter((t) => canTeachSubject(t, a.subject.id)).length;
    const eligibleB = teachers.filter((t) => canTeachSubject(t, b.subject.id)).length;
    if (eligibleA !== eligibleB) return eligibleA - eligibleB;
    const daysA = getSubjectAllowedDays(a.subject).length;
    const daysB = getSubjectAllowedDays(b.subject).length;
    if (daysA !== daysB) return daysA - daysB;
    return b.remaining - a.remaining;
  });

  for (const assignment of assignments) {
    const { cls, subject } = assignment;
    let remaining = assignment.remaining;
    const classState = classStates.get(cls.id)!;
    const allowedDays = getSubjectAllowedDays(subject);
    const allowedSlots = getSubjectAllowedSlots(subject, MAX_SLOT);

    while (remaining > 0) {
      let placed = false;

      // Build candidate (day, slot) pairs, shuffled to avoid bias
      const candidateSlots: SlotKey[] = [];
      for (const day of shuffle(allowedDays)) {
        const dayCount = classState.slotsPerDay.get(day) ?? 0;
        if (dayCount >= cls.max_hours_per_day) continue;
        for (const slot of shuffle(allowedSlots)) {
          if (classState.slots.has(slotKey(day, slot))) continue;
          candidateSlots.push({ day, slot });
        }
      }

      // Find eligible teachers, prefer those with fewer free periods
      const eligibleTeachers = teachers
        .filter((t) => {
          if (!canTeachSubject(t, subject.id)) return false;
          if (t.hours_per_week <= (teacherStates.get(t.id)?.assignedHours ?? 0)) return false;
          return true;
        })
        .sort((a, b) => {
          const stateA = teacherStates.get(a.id)!;
          const stateB = teacherStates.get(b.id)!;
          const freesA = countTeacherFreePeriods(stateA);
          const freesB = countTeacherFreePeriods(stateB);
          // Prefer fewer free periods (minimize gaps)
          if (freesA !== freesB) return freesA - freesB;
          // Prefer more remaining capacity
          return (b.hours_per_week - stateB.assignedHours) - (a.hours_per_week - stateA.assignedHours);
        });

      for (const candidate of candidateSlots) {
        const { day, slot } = candidate;

        // Find best available teacher for this slot
        const teacher = eligibleTeachers.find((t) => {
          if (!isTeacherAvailableOnDay(t, day)) return false;
          const ts = teacherStates.get(t.id)!;
          return !ts.busySlots.has(slotKey(day, slot));
        });

        if (!teacher) continue;

        const teacherState = teacherStates.get(teacher.id)!;

        // Place the entry
        entries.push({
          class_id: cls.id,
          subject_id: subject.id,
          teacher_id: teacher.id,
          day,
          slot,
          is_double_staffed: false,
          class_name: cls.name,
          subject_name: subject.name,
          teacher_abbreviation: teacher.abbreviation,
          teacher_name: `${teacher.first_name} ${teacher.last_name}`,
        });

        // Update states
        teacherState.assignedHours++;
        teacherState.busySlots.add(slotKey(day, slot));
        classState.slots.add(slotKey(day, slot));
        classState.slotsPerDay.set(day, (classState.slotsPerDay.get(day) ?? 0) + 1);
        classState.hoursAssigned.set(
          subject.id,
          (classState.hoursAssigned.get(subject.id) ?? 0) + 1,
        );

        remaining--;
        placed = true;
        break;
      }

      if (!placed) {
        warnings.push(
          `Konnte nicht alle Stunden für Klasse "${cls.name}", Fach "${subject.name}" einplanen. ` +
            `${remaining} Stunde(n) nicht zugewiesen.`,
        );
        break;
      }
    }
  }

  // Try to assign double staffing for remaining teacher capacity
  _assignDoubleStaffing(entries, teachers, teacherStates, warnings);

  return {
    timetable: {
      name: `Stundenplan ${new Date().toLocaleDateString("de-DE")}`,
      generated_at: new Date().toISOString(),
      school_year: "",
    },
    entries,
    warnings,
  };
}

function _assignDoubleStaffing(
  entries: Omit<TimetableEntry, "id" | "timetable_id">[],
  teachers: Teacher[],
  teacherStates: Map<number, TeacherState>,
  warnings: string[],
) {
  for (const entry of entries) {
    if (entry.is_double_staffed) continue;

    const availableTeachers = teachers.filter((t) => {
      if (t.id === entry.teacher_id) return false;
      if (!canTeachSubject(t, entry.subject_id)) return false;
      const ts = teacherStates.get(t.id)!;
      if (ts.assignedHours >= t.hours_per_week) return false;
      if (!isTeacherAvailableOnDay(t, entry.day)) return false;
      if (ts.busySlots.has(slotKey(entry.day, entry.slot))) return false;
      return true;
    });

    if (availableTeachers.length > 0) {
      const secondTeacher = availableTeachers[0];
      const ts = teacherStates.get(secondTeacher.id)!;
      entry.is_double_staffed = true;
      ts.assignedHours++;
      ts.busySlots.add(slotKey(entry.day, entry.slot));
    }
  }

  void warnings;
}
