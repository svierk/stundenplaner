import type {
  Teacher,
  SchoolClass,
  Subject,
  TimetableEntry,
  Weekday,
  SchedulerResult,
  GradeLevel,
  GradeLevelConfig,
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
  hoursAssigned: Map<number, number>;
  slotsPerDay: Map<Weekday, number>;        // total slots per day (non-AG + AG) — used for max constraint
  nonAgSlotsPerDay: Map<Weekday, number>;   // non-AG slots per day — used for min constraint
  slots: Set<string>;
  subjectDaySlots: Map<string, Set<number>>;
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

function effectiveHours(teacher: Teacher): number {
  return Math.max(0, teacher.hours_per_week - teacher.additional_duty_hours);
}

// Returns true if the teacher is explicitly allowed for this subject in this class.
// An allowed subject with no class restriction counts for any class.
function isSubjectAllowedForClass(teacher: Teacher, subjectId: number, classId: number): boolean {
  if (teacher.forbidden_subject_ids.includes(subjectId)) return false;
  const entry = teacher.allowed_subjects.find((a) => a.subject_id === subjectId);
  if (!entry) return false;
  return entry.class_ids.length === 0 || entry.class_ids.includes(classId);
}

// Returns true if this teacher is specifically designated for this subject in this class
// (allowed subject with an explicit, non-empty class restriction that includes classId).
function isDesignatedForClass(teacher: Teacher, subjectId: number, classId: number): boolean {
  if (teacher.forbidden_subject_ids.includes(subjectId)) return false;
  const entry = teacher.allowed_subjects.find((a) => a.subject_id === subjectId);
  return !!entry && entry.class_ids.length > 0 && entry.class_ids.includes(classId);
}

// Returns true if the teacher is not explicitly forbidden from teaching this subject.
// Includes fallback capability (priority 3).
function canTeachSubject(teacher: Teacher, subjectId: number): boolean {
  return !teacher.forbidden_subject_ids.includes(subjectId);
}

// Lower number = higher priority.
// 1 = specifically designated (allowed + class restriction matches this class)
// 2 = generally allowed (no class restriction)
// 3 = fallback (not forbidden; includes allowed-for-other-class)
function teacherSubjectPriority(teacher: Teacher, subjectId: number, classId: number): number {
  if (teacher.forbidden_subject_ids.includes(subjectId)) return 4;
  const entry = teacher.allowed_subjects.find((a) => a.subject_id === subjectId);
  if (!entry) return 3;
  if (entry.class_ids.length > 0 && entry.class_ids.includes(classId)) return 1;
  if (entry.class_ids.length === 0) return 2;
  // Allowed for other classes → fallback for this one (still eligible, just not preferred)
  return 3;
}

function isTeacherAvailableOnDay(teacher: Teacher, day: Weekday): boolean {
  if (!teacher.has_free_day) return true;
  return !teacher.free_days.includes(day);
}

function isTeacherAvailableAtSlot(teacher: Teacher, slot: number): boolean {
  if (!teacher.has_free_slots) return true;
  return !teacher.free_slots.includes(slot);
}

function getSubjectAllowedDays(subject: Subject): Weekday[] {
  return subject.allowed_days.length > 0
    ? subject.allowed_days
    : ([1, 2, 3, 4, 5] as Weekday[]);
}

function wouldViolateDoublePeriodRule(existingSlots: Set<number>, slot: number, noDoublePeriods: boolean): boolean {
  const hasLeft = existingSlots.has(slot - 1);
  const hasRight = existingSlots.has(slot + 1);

  if (noDoublePeriods && (hasLeft || hasRight)) return true;

  // Max 2 consecutive: adding this slot must not create a run of 3
  const runLeft = hasLeft ? (existingSlots.has(slot - 2) ? 2 : 1) : 0;
  const runRight = hasRight ? (existingSlots.has(slot + 2) ? 2 : 1) : 0;
  return runLeft + 1 + runRight > 2;
}

function getSubjectAllowedSlots(subject: Subject, maxSlot: number): number[] {
  const slots = subject.allowed_slots.length > 0
    ? subject.allowed_slots
    : Array.from({ length: maxSlot }, (_, i) => i + 1);
  return slots.filter((s) => s <= maxSlot);
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

/**
 * Scores placing a lesson at (day, slot) for a teacher from a gap-avoidance perspective.
 * 0 = extends or fills an existing block on that day (best)
 * 1 = teacher has no lessons on that day yet (neutral — new day, no gap created)
 * 2 = would create an intra-day gap (worst)
 */
function teacherSlotGapScore(state: TeacherState | null, day: Weekday, slot: number): number {
  if (!state) return 1;
  const daySlots: number[] = [];
  for (const key of state.busySlots) {
    const [d, s] = key.split("-").map(Number);
    if (d === day) daySlots.push(s);
  }
  if (daySlots.length === 0) return 1;
  const min = Math.min(...daySlots);
  const max = Math.max(...daySlots);
  if (slot === min - 1 || slot === max + 1 || (slot > min && slot < max)) return 0;
  return 2;
}

/**
 * Returns the effective category for a subject at a given grade level,
 * respecting per-grade category_override if set.
 */
function isAgAssignment(subject: Subject, gradeLevel: GradeLevel): boolean {
  const gc = subject.grade_configs.find((g) => g.grade_level === gradeLevel);
  return (gc?.category_override ?? subject.category) === "activity";
}

export function generateTimetable(
  teachers: Teacher[],
  classes: SchoolClass[],
  subjects: Subject[],
  gradeLevelConfigs: GradeLevelConfig[],
): SchedulerResult {
  const warnings: string[] = [];
  const entries: Omit<TimetableEntry, "id" | "timetable_id">[] = [];

  // Tracks globally used (day, slot) pairs per subject for no_parallel_classes enforcement
  const subjectGlobalSlots = new Map<number, Set<string>>();

  // Precompute bidirectional mutual exclusion map from no_parallel_subject_ids.
  // If subject A lists B, neither can occupy the same (day, slot) regardless of which is scheduled first.
  const mutualExclusions = new Map<number, Set<number>>();
  for (const subject of subjects) {
    if (!subject.no_parallel_classes || subject.no_parallel_subject_ids.length === 0) continue;
    for (const otherId of subject.no_parallel_subject_ids) {
      if (!mutualExclusions.has(subject.id)) mutualExclusions.set(subject.id, new Set());
      mutualExclusions.get(subject.id)!.add(otherId);
      if (!mutualExclusions.has(otherId)) mutualExclusions.set(otherId, new Set());
      mutualExclusions.get(otherId)!.add(subject.id);
    }
  }

  const maxHoursPerDayByGrade = new Map(
    gradeLevelConfigs.map((c) => [c.grade_level, c.max_hours_per_day]),
  );
  const minHoursPerDayByGrade = new Map(
    gradeLevelConfigs.map((c) => [c.grade_level, c.min_hours_per_day]),
  );

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
        nonAgSlotsPerDay: new Map(),
        slots: new Set(),
        subjectDaySlots: new Map(),
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
    for (const subject of subjects) {
      const gradeConfig = subject.grade_configs.find((gc) => gc.grade_level === cls.grade_level);
      if (!gradeConfig || gradeConfig.hours_per_week <= 0) continue;
      assignments.push({
        cls,
        subject,
        remaining: gradeConfig.hours_per_week,
        gradeLevel: cls.grade_level,
      });
    }
  }

  // Sort assignments: AG subjects last (boundary placement needs non-AG already scheduled),
  // then designated first, then most constrained, then fewer allowed days, then more hours.
  assignments.sort((a, b) => {
    const isAgA = isAgAssignment(a.subject, a.gradeLevel);
    const isAgB = isAgAssignment(b.subject, b.gradeLevel);
    if (isAgA !== isAgB) return isAgA ? 1 : -1;
    const hasDesA = teachers.some((t) => isDesignatedForClass(t, a.subject.id, a.cls.id));
    const hasDesB = teachers.some((t) => isDesignatedForClass(t, b.subject.id, b.cls.id));
    if (hasDesA !== hasDesB) return hasDesA ? -1 : 1;
    const eligibleA = teachers.filter((t) => isSubjectAllowedForClass(t, a.subject.id, a.cls.id)).length;
    const eligibleB = teachers.filter((t) => isSubjectAllowedForClass(t, b.subject.id, b.cls.id)).length;
    if (eligibleA !== eligibleB) return eligibleA - eligibleB;
    const daysA = getSubjectAllowedDays(a.subject).length;
    const daysB = getSubjectAllowedDays(b.subject).length;
    if (daysA !== daysB) return daysA - daysB;
    return b.remaining - a.remaining;
  });

  // Tracks which teacher is locked in for each (class, subject) pair
  const classSubjectTeacher = new Map<string, number>();

  for (const assignment of assignments) {
    const { cls, subject } = assignment;
    let remaining = assignment.remaining;
    const classState = classStates.get(cls.id)!;
    const allowedDays = getSubjectAllowedDays(subject);
    const gradeMaxSlot = maxHoursPerDayByGrade.get(cls.grade_level) ?? 6;
    const gradeMinSlot = minHoursPerDayByGrade.get(cls.grade_level) ?? 4;
    const allowedSlots = getSubjectAllowedSlots(subject, gradeMaxSlot);
    const csKey = `${cls.id}-${subject.id}`;

    const isAg = isAgAssignment(subject, cls.grade_level);

    while (remaining > 0) {
      // Read the lock inside the loop so it takes effect from the 2nd hour onward
      const lockedTeacherId = classSubjectTeacher.get(csKey);
      let placed = false;

      // Determine which teacher state to use for gap-avoidance scoring.
      const gapScoringState: TeacherState | null = lockedTeacherId !== undefined
        ? (teacherStates.get(lockedTeacherId) ?? null)
        : (() => {
            const best = teachers
              .filter((t) => canTeachSubject(t, subject.id) && effectiveHours(t) > (teacherStates.get(t.id)?.assignedHours ?? 0))
              .sort((a, b) => teacherSubjectPriority(a, subject.id, cls.id) - teacherSubjectPriority(b, subject.id, cls.id))[0];
            return best ? (teacherStates.get(best.id) ?? null) : null;
          })();

      const candidateSlots: SlotKey[] = [];

      if (isAg) {
        // AG subjects must sit at the boundary of the day (before the first lesson or after
        // the last lesson). A day is only eligible once it already has >= gradeMinSlot
        // non-AG lessons so the minimum is met regardless of the AG.
        for (const day of shuffle(allowedDays)) {
          const nonAgCount = classState.nonAgSlotsPerDay.get(day) ?? 0;
          const totalCount = classState.slotsPerDay.get(day) ?? 0;
          if (nonAgCount < gradeMinSlot) continue;  // min must be met by non-AG alone
          if (totalCount >= gradeMaxSlot) continue;  // AG counts toward max

          const daySlotNums: number[] = [];
          for (const key of classState.slots) {
            const [d, s] = key.split("-").map(Number);
            if (d === day) daySlotNums.push(s);
          }
          if (daySlotNums.length === 0) continue;

          const minSl = Math.min(...daySlotNums);
          const maxSl = Math.max(...daySlotNums);
          const globalSlots = subjectGlobalSlots.get(subject.id);
          const excluded = mutualExclusions.get(subject.id);

          for (const slot of [minSl - 1, maxSl + 1]) {
            if (slot < 1 || slot > gradeMaxSlot) continue;
            // Respect explicit allowed_slots restriction if configured
            if (subject.allowed_slots.length > 0 && !subject.allowed_slots.includes(slot)) continue;
            const sk = slotKey(day, slot);
            if (classState.slots.has(sk)) continue;
            const blocked =
              (subject.no_parallel_classes && globalSlots?.has(sk)) ||
              !!(excluded && [...excluded].some((id) => subjectGlobalSlots.get(id)?.has(sk)));
            if (blocked) continue;
            candidateSlots.push({ day, slot });
          }
        }
      } else {
        // Non-AG: standard slot selection.
        // Day priority: started-but-below-min non-AG (0) → empty (1) → at-or-above-min (2).
        // Within group, prefer days that keep the scoring teacher's schedule compact.
        const orderedDays = shuffle(allowedDays).sort((a, b) => {
          const nonAgA = classState.nonAgSlotsPerDay.get(a) ?? 0;
          const nonAgB = classState.nonAgSlotsPerDay.get(b) ?? 0;
          const totalA = classState.slotsPerDay.get(a) ?? 0;
          const totalB = classState.slotsPerDay.get(b) ?? 0;
          const ga = nonAgA === 0 ? 1 : nonAgA < gradeMinSlot ? 0 : 2;
          const gb = nonAgB === 0 ? 1 : nonAgB < gradeMinSlot ? 0 : 2;
          if (ga !== gb) return ga - gb;
          const nextSlotA = !cls.allow_free_periods ? totalA + 1 : -1;
          const nextSlotB = !cls.allow_free_periods ? totalB + 1 : -1;
          if (nextSlotA > 0 && nextSlotB > 0) {
            const tgA = teacherSlotGapScore(gapScoringState, a, nextSlotA);
            const tgB = teacherSlotGapScore(gapScoringState, b, nextSlotB);
            if (tgA !== tgB) return tgA - tgB;
          }
          return nonAgA - nonAgB;
        });

        for (const day of orderedDays) {
          const totalDayCount = classState.slotsPerDay.get(day) ?? 0;
          if (totalDayCount >= gradeMaxSlot) continue;

          const sdKey = `${subject.id}-${day}`;
          const subjectSlotsOnDay = classState.subjectDaySlots.get(sdKey) ?? new Set<number>();
          const globalSlots = subjectGlobalSlots.get(subject.id);
          const excluded = mutualExclusions.get(subject.id);

          const isParallelBlocked = (sk: string) => {
            if (subject.no_parallel_classes && globalSlots?.has(sk)) return true;
            if (excluded) {
              for (const excId of excluded) {
                if (subjectGlobalSlots.get(excId)?.has(sk)) return true;
              }
            }
            return false;
          };

          if (!cls.allow_free_periods) {
            // Enforce contiguous scheduling — only the next consecutive slot is valid
            const nextSlot = totalDayCount + 1;
            const sk = slotKey(day, nextSlot);
            if (
              nextSlot <= gradeMaxSlot &&
              allowedSlots.includes(nextSlot) &&
              !classState.slots.has(sk) &&
              !wouldViolateDoublePeriodRule(subjectSlotsOnDay, nextSlot, subject.no_double_periods) &&
              !isParallelBlocked(sk)
            ) {
              candidateSlots.push({ day, slot: nextSlot });
            }
          } else {
            // Collect valid slots, shuffle for randomness, then sort by teacher gap score.
            const daySlots = shuffle(allowedSlots).filter((slot) => {
              const sk = slotKey(day, slot);
              return (
                !classState.slots.has(sk) &&
                !wouldViolateDoublePeriodRule(subjectSlotsOnDay, slot, subject.no_double_periods) &&
                !isParallelBlocked(sk)
              );
            });
            daySlots.sort((a, b) =>
              teacherSlotGapScore(gapScoringState, day, a) - teacherSlotGapScore(gapScoringState, day, b),
            );
            for (const slot of daySlots) candidateSlots.push({ day, slot });
          }
        }

        // Final global sort for free-period classes: class-day group first, then teacher gap.
        if (cls.allow_free_periods) {
          candidateSlots.sort((a, b) => {
            const nonAgA = classState.nonAgSlotsPerDay.get(a.day) ?? 0;
            const nonAgB = classState.nonAgSlotsPerDay.get(b.day) ?? 0;
            const ga = nonAgA === 0 ? 1 : nonAgA < gradeMinSlot ? 0 : 2;
            const gb = nonAgB === 0 ? 1 : nonAgB < gradeMinSlot ? 0 : 2;
            if (ga !== gb) return ga - gb;
            return teacherSlotGapScore(gapScoringState, a.day, a.slot) - teacherSlotGapScore(gapScoringState, b.day, b.slot);
          });
        }
      }

      // If a teacher is locked for this class+subject, only consider them.
      // Otherwise rank by: 1) subject priority (core > allowed > fallback)
      //                     2) fewer teacher free-period gaps
      //                     3) more remaining capacity
      const eligibleTeachers = teachers
        .filter((t) => {
          if (lockedTeacherId !== undefined) {
            return (
              t.id === lockedTeacherId &&
              effectiveHours(t) > (teacherStates.get(t.id)?.assignedHours ?? 0)
            );
          }
          if (!canTeachSubject(t, subject.id)) return false;
          if (effectiveHours(t) <= (teacherStates.get(t.id)?.assignedHours ?? 0)) return false;
          return true;
        })
        .sort((a, b) => {
          const prioA = teacherSubjectPriority(a, subject.id, cls.id);
          const prioB = teacherSubjectPriority(b, subject.id, cls.id);
          if (prioA !== prioB) return prioA - prioB;
          const stateA = teacherStates.get(a.id)!;
          const stateB = teacherStates.get(b.id)!;
          const freesA = countTeacherFreePeriods(stateA);
          const freesB = countTeacherFreePeriods(stateB);
          if (freesA !== freesB) return freesA - freesB;
          return (effectiveHours(b) - stateB.assignedHours) - (effectiveHours(a) - stateA.assignedHours);
        });

      for (const candidate of candidateSlots) {
        const { day, slot } = candidate;

        const teacher = eligibleTeachers.find((t) => {
          if (!isTeacherAvailableOnDay(t, day)) return false;
          if (!isTeacherAvailableAtSlot(t, slot)) return false;
          const ts = teacherStates.get(t.id)!;
          return !ts.busySlots.has(slotKey(day, slot));
        });

        if (!teacher) continue;

        const teacherState = teacherStates.get(teacher.id)!;

        // Lock this teacher to this class+subject pair on first placement
        if (!classSubjectTeacher.has(csKey)) {
          classSubjectTeacher.set(csKey, teacher.id);
        }

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

        teacherState.assignedHours++;
        teacherState.busySlots.add(slotKey(day, slot));
        classState.slots.add(slotKey(day, slot));
        classState.slotsPerDay.set(day, (classState.slotsPerDay.get(day) ?? 0) + 1);
        if (!isAg) {
          classState.nonAgSlotsPerDay.set(day, (classState.nonAgSlotsPerDay.get(day) ?? 0) + 1);
        }
        classState.hoursAssigned.set(
          subject.id,
          (classState.hoursAssigned.get(subject.id) ?? 0) + 1,
        );
        const sdKey = `${subject.id}-${day}`;
        if (!classState.subjectDaySlots.has(sdKey)) classState.subjectDaySlots.set(sdKey, new Set());
        classState.subjectDaySlots.get(sdKey)!.add(slot);
        if (!subjectGlobalSlots.has(subject.id)) subjectGlobalSlots.set(subject.id, new Set());
        subjectGlobalSlots.get(subject.id)!.add(slotKey(day, slot));

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

  // Warn about days where the non-AG lesson count is below the grade-level minimum.
  // AG lessons are excluded from the minimum requirement.
  const dayNames = ['', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'];
  for (const classState of classStates.values()) {
    const gradeMin = minHoursPerDayByGrade.get(classState.cls.grade_level) ?? 4;
    for (const [day, nonAgCount] of classState.nonAgSlotsPerDay) {
      if (nonAgCount < gradeMin) {
        warnings.push(
          `Klasse "${classState.cls.name}", ${dayNames[day]}: nur ${nonAgCount} Stunde(n) geplant — Minimum für Klassenstufe ${classState.cls.grade_level} ist ${gradeMin}.`,
        );
      }
    }
  }

  // Build set of subjects excluded from double staffing
  const noDoubleStaffingIds = new Set(subjects.filter((s) => s.no_double_staffing).map((s) => s.id));

  // Try to assign double staffing for remaining teacher capacity
  _assignDoubleStaffing(entries, teachers, teacherStates, noDoubleStaffingIds, warnings);

  return {
    timetable: {
      name: "",
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
  noDoubleStaffingIds: Set<number>,
  warnings: string[],
) {
  for (const entry of entries) {
    if (entry.is_double_staffed) continue;
    if (noDoubleStaffingIds.has(entry.subject_id)) continue;

    const availableTeachers = teachers
      .filter((t) => {
        if (t.id === entry.teacher_id) return false;
        if (!canTeachSubject(t, entry.subject_id)) return false;
        const ts = teacherStates.get(t.id)!;
        if (ts.assignedHours >= effectiveHours(t)) return false;
        if (!isTeacherAvailableOnDay(t, entry.day)) return false;
        if (!isTeacherAvailableAtSlot(t, entry.slot)) return false;
        if (ts.busySlots.has(slotKey(entry.day, entry.slot))) return false;
        return true;
      })
      .sort((a, b) => {
        const prioA = teacherSubjectPriority(a, entry.subject_id, entry.class_id);
        const prioB = teacherSubjectPriority(b, entry.subject_id, entry.class_id);
        if (prioA !== prioB) return prioA - prioB;
        // Prefer teacher for whom this slot extends an existing block
        const gapA = teacherSlotGapScore(teacherStates.get(a.id)!, entry.day as Weekday, entry.slot);
        const gapB = teacherSlotGapScore(teacherStates.get(b.id)!, entry.day as Weekday, entry.slot);
        return gapA - gapB;
      });

    if (availableTeachers.length > 0) {
      const secondTeacher = availableTeachers[0];
      const ts = teacherStates.get(secondTeacher.id)!;
      entry.is_double_staffed = true;
      entry.second_teacher_id = secondTeacher.id;
      entry.second_teacher_abbreviation = secondTeacher.abbreviation;
      entry.second_teacher_name = `${secondTeacher.first_name} ${secondTeacher.last_name}`;
      ts.assignedHours++;
      ts.busySlots.add(slotKey(entry.day, entry.slot));
    }
  }

  void warnings;
}
