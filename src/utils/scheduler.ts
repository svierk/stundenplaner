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
  mainHours: number;    // primary Hauptfach teaching hours
  minorHours: number;   // primary Nebenfach teaching hours
  agHours: number;      // primary AG teaching hours
  doubleHours: number;  // secondary double-staffing hours (counted toward capacity but no extra prep)
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
      { teacher: t, assignedHours: 0, mainHours: 0, minorHours: 0, agHours: 0, doubleHours: 0, busySlots: new Set() },
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

  // Sort assignments: most-constrained first so that tightly-restricted subjects are placed
  // before less-constrained ones can occupy their only available slots.
  //
  // Priority order:
  //   1. AG subjects last (need non-AG already scheduled at boundary)
  //   2. "Ultra-constrained" FIRST: coupled group + slot restriction.
  //      These need ALL coupled classes simultaneously free at a specific slot.
  //      Must run before even designated subjects, which would otherwise claim those slots.
  //   3. Designated teacher first (guaranteed resource → resolve early)
  //   4. Fewest slot-day combinations: days × (slots || ALL_SLOTS)
  //   5. Coupled groups before uncoupled at same slot constraint
  //   6. Fewer eligible teachers
  //   7. More hours remaining
  assignments.sort((a, b) => {
    const isAgA = isAgAssignment(a.subject, a.gradeLevel);
    const isAgB = isAgAssignment(b.subject, b.gradeLevel);
    if (isAgA !== isAgB) return isAgA ? 1 : -1;
    // Ultra-constrained: coupled group WITH slot restriction — must be placed absolutely first
    // so that no other subject (even a designated one) can claim their required slots.
    const isUCA = a.subject.coupled_class_ids.length > 0 && a.subject.allowed_slots.length > 0;
    const isUCB = b.subject.coupled_class_ids.length > 0 && b.subject.allowed_slots.length > 0;
    if (isUCA !== isUCB) return isUCA ? -1 : 1;
    // Coupled + partner: must drive before the partner's designated teachers fill slots.
    // Without this, the partner (e.g. Deutsch) sorts first via the designation check below
    // and independently co-places the coupled subject per-class with different teachers.
    const isCPA = a.subject.coupled_class_ids.length > 0 && a.subject.parallel_partner_subject_id !== null;
    const isCPB = b.subject.coupled_class_ids.length > 0 && b.subject.parallel_partner_subject_id !== null;
    if (isCPA !== isCPB) return isCPA ? -1 : 1;
    const hasDesA = teachers.some((t) => isDesignatedForClass(t, a.subject.id, a.cls.id));
    const hasDesB = teachers.some((t) => isDesignatedForClass(t, b.subject.id, b.cls.id));
    if (hasDesA !== hasDesB) return hasDesA ? -1 : 1;
    const ALL_SLOTS = 99; // proxy for "no slot restriction"
    const slotsA = a.subject.allowed_slots.length > 0 ? a.subject.allowed_slots.length : ALL_SLOTS;
    const slotsB = b.subject.allowed_slots.length > 0 ? b.subject.allowed_slots.length : ALL_SLOTS;
    const constraintA = getSubjectAllowedDays(a.subject).length * slotsA;
    const constraintB = getSubjectAllowedDays(b.subject).length * slotsB;
    if (constraintA !== constraintB) return constraintA - constraintB;
    if (a.subject.coupled_class_ids.length !== b.subject.coupled_class_ids.length) {
      return b.subject.coupled_class_ids.length - a.subject.coupled_class_ids.length;
    }
    const eligibleA = teachers.filter((t) => isSubjectAllowedForClass(t, a.subject.id, a.cls.id)).length;
    const eligibleB = teachers.filter((t) => isSubjectAllowedForClass(t, b.subject.id, b.cls.id)).length;
    if (eligibleA !== eligibleB) return eligibleA - eligibleB;
    return b.remaining - a.remaining;
  });

  // Tracks which teacher is locked in for each (class, subject) pair
  const classSubjectTeacher = new Map<string, number>();

  // ── Parallel scheduling pre-processing ──────────────────────────────────────
  //
  // coupled_class_ids: the subject must be taught to all listed classes simultaneously
  // by the SAME teacher. The first class encountered in the assignments list is the
  // "leader"; follower assignments are skipped and handled during leader placement.
  //
  // parallel_partner_subject_id: a partner subject must be placed at the exact same
  // (day, slot) for the same class with a DIFFERENT teacher (hard constraint).
  // Bidirectionality: both subjects point to each other, but only the one with the
  // lower subject-id drives the co-placement to prevent double-scheduling.

  // Build set of "follower" assignment keys that will be handled by their group leader.
  const coupledFollowers = new Set<string>(); // "${class_id}-${subject_id}"
  for (const subject of subjects) {
    if (subject.coupled_class_ids.length === 0) continue;
    // Find all assignments for this subject that involve one of the coupled classes
    const groupAssignments = assignments.filter(
      (a) => a.subject.id === subject.id && subject.coupled_class_ids.includes(a.cls.id),
    );
    // First occurrence is leader, rest are followers
    for (let i = 1; i < groupAssignments.length; i++) {
      coupledFollowers.add(`${groupAssignments[i].cls.id}-${subject.id}`);
    }
  }

  // Rank classes deterministically for staggered start/end times.
  // Each class alternates its preferred start slot (1 or 2) per day based on
  // (rank + day) parity, so adjacent classes have complementary schedules.
  const classRank = new Map<number, number>();
  [...classes]
    .sort((a, b) => a.grade_level !== b.grade_level ? a.grade_level - b.grade_level : a.name.localeCompare(b.name))
    .forEach((c, i) => classRank.set(c.id, i));

  for (const assignment of assignments) {
    const { cls, subject } = assignment;

    // Skip follower assignments in coupled groups — handled by the group leader
    if (coupledFollowers.has(`${cls.id}-${subject.id}`)) continue;

    // Skip partner assignments driven by the other side (lower subject-id drives).
    // Exception: if this subject has coupled_class_ids but the partner does not, this
    // subject must always drive so the coupled group is handled by a single leader pass.
    if (subject.parallel_partner_subject_id !== null) {
      const pId = subject.parallel_partner_subject_id;
      if (pId < subject.id) {
        const partnerSubj = subjects.find((s) => s.id === pId);
        if (partnerSubj?.parallel_partner_subject_id === subject.id) {
          const thisCoupled = subject.coupled_class_ids.length > 0;
          const partnerCoupled = (partnerSubj?.coupled_class_ids.length ?? 0) > 0;
          if (!(thisCoupled && !partnerCoupled)) continue;
        }
      }
    }

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
          if (!cls.allow_free_periods) {
            const rv = classRank.get(cls.id) ?? 0;
            const cs = gradeMaxSlot - gradeMinSlot >= 1;
            const nextSlotA = totalA + ((cs && (rv + (a as number)) % 2 === 0) ? 2 : 1);
            const nextSlotB = totalB + ((cs && (rv + (b as number)) % 2 === 0) ? 2 : 1);
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
          if (subject.no_repeat_per_day && subjectSlotsOnDay.size > 0) continue;
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

          // Staggered start: even (rank+day) parity → prefer slot 2, odd → slot 1.
          // Only stagger when max > min so the minimum lesson count per day is still reachable.
          const rankVal = classRank.get(cls.id) ?? 0;
          const canStagger = gradeMaxSlot - gradeMinSlot >= 1;
          const startSlotForDay = (canStagger && (rankVal + (day as number)) % 2 === 0) ? 2 : 1;

          if (!cls.allow_free_periods) {
            // Determine effective starting slot for this class on this day.
            // Priority:
            // 1. If lessons are already placed on this day (e.g. by a coupled group),
            //    anchor from their minimum slot to avoid gaps.
            // 2. If the subject has allowed_slots restrictions that conflict with the
            //    stagger offset, use the minimum allowed slot instead.
            // 3. Otherwise apply the stagger formula.
            let effectiveStart = startSlotForDay;
            let dayMinPlaced = Infinity;
            for (const key of classState.slots) {
              const [d, s] = key.split("-").map(Number);
              if (d === (day as number)) dayMinPlaced = Math.min(dayMinPlaced, s);
            }
            if (dayMinPlaced !== Infinity) {
              effectiveStart = dayMinPlaced;
            } else if (subject.allowed_slots.length > 0 && !subject.allowed_slots.includes(startSlotForDay)) {
              effectiveStart = allowedSlots[0] ?? startSlotForDay;
            }
            const nextSlot = effectiveStart + totalDayCount;
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
            // For slot-restricted subjects: also try prepending before the existing block.
            // A slot at dayMinPlaced−1 is adjacent to the first lesson → no gap created.
            // This handles the case where designated subjects filled slots 2..N first, leaving
            // slot 1 available for a subject that is restricted to slot 1.
            if (dayMinPlaced !== Infinity && subject.allowed_slots.length > 0) {
              const prependSlot = dayMinPlaced - 1;
              const prependSk = slotKey(day, prependSlot);
              if (
                prependSlot >= 1 &&
                allowedSlots.includes(prependSlot) &&
                !classState.slots.has(prependSk) &&
                !wouldViolateDoublePeriodRule(subjectSlotsOnDay, prependSlot, subject.no_double_periods) &&
                !isParallelBlocked(prependSk)
              ) {
                candidateSlots.push({ day, slot: prependSlot });
              }
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
            daySlots.sort((slotA, slotB) => {
              const gapA = teacherSlotGapScore(gapScoringState, day, slotA);
              const gapB = teacherSlotGapScore(gapScoringState, day, slotB);
              if (gapA !== gapB) return gapA - gapB;
              // When placing the first lesson on a day, bias toward startSlotForDay
              if (totalDayCount === 0) return Math.abs(slotA - startSlotForDay) - Math.abs(slotB - startSlotForDay);
              return 0;
            });
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

      // Rank eligible teachers by:
      //   1) subject priority (designated > allowed > fallback)
      //   2) fewer intra-day free-period gaps
      //   3) fairness: lower weighted primary workload (Hauptfach=3, Nebenfach/AG=1)
      //      so that heavy and light subjects are spread evenly across the team
      //   4) remaining capacity as final tiebreaker
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
          // Weighted primary workload: Hauptfach counts 3×, everything else 1×.
          // Normalised by capacity so teachers with different weekly hours are comparable.
          const capA = effectiveHours(a) || 1;
          const capB = effectiveHours(b) || 1;
          const loadA = (stateA.mainHours * 3 + stateA.minorHours + stateA.agHours) / capA;
          const loadB = (stateB.mainHours * 3 + stateB.minorHours + stateB.agHours) / capB;
          if (Math.abs(loadA - loadB) > 0.05) return loadA - loadB;
          return (effectiveHours(b) - stateB.assignedHours) - (effectiveHours(a) - stateA.assignedHours);
        });

      for (const candidate of candidateSlots) {
        const { day, slot } = candidate;
        const sk = slotKey(day, slot);

        // ── Coupled-class pre-check ──────────────────────────────────────────
        // All follower classes must also have this slot free before we commit.
        const followerClasses = subject.coupled_class_ids
          .filter((id) => id !== cls.id)
          .map((id) => ({ cls: classes.find((c) => c.id === id)!, state: classStates.get(id)! }))
          .filter((f) => f.cls && f.state);
        if (followerClasses.some((f) => f.state.slots.has(sk))) continue;

        // ── Partner-subject pre-check ────────────────────────────────────────
        // A different teacher for the partner subject must be available at this slot.
        let partnerTeacher: Teacher | undefined;
        const partnerId = subject.parallel_partner_subject_id;
        if (partnerId !== null) {
          const partnerAssignment = assignments.find(
            (a) => a.cls.id === cls.id && a.subject.id === partnerId,
          );
          if (partnerAssignment && partnerAssignment.remaining > 0) {
            const partnerCsKey = `${cls.id}-${partnerId}`;
            const lockedPartner = classSubjectTeacher.get(partnerCsKey);
            partnerTeacher = teachers.find((t) => {
              if (lockedPartner !== undefined && t.id !== lockedPartner) return false;
              if (!canTeachSubject(t, partnerId)) return false;
              const ts = teacherStates.get(t.id)!;
              if (effectiveHours(t) <= ts.assignedHours) return false;
              if (!isTeacherAvailableOnDay(t, day)) return false;
              if (!isTeacherAvailableAtSlot(t, slot)) return false;
              if (ts.busySlots.has(sk)) return false;
              return true; // teacher for primary will be filtered out below
            });
            // Partner teacher must be a different person than the primary teacher
            // We'll enforce this after we know the primary teacher.
          }
        }

        const teacher = eligibleTeachers.find((t) => {
          if (!isTeacherAvailableOnDay(t, day)) return false;
          if (!isTeacherAvailableAtSlot(t, slot)) return false;
          const ts = teacherStates.get(t.id)!;
          return !ts.busySlots.has(sk);
        });

        if (!teacher) continue;

        // Re-resolve partner teachers for leader + all follower classes.
        // Each class needs its own distinct teacher — usedPartnerIds prevents conflicts.
        const followerPartnerTeachers = new Map<number, Teacher>(); // classId → teacher
        if (partnerId !== null) {
          const usedPartnerIds = new Set<number>([teacher.id]);

          // Leader class
          const partnerAssignment = assignments.find(
            (a) => a.cls.id === cls.id && a.subject.id === partnerId,
          );
          if (partnerAssignment && partnerAssignment.remaining > 0) {
            const lockedPartner = classSubjectTeacher.get(`${cls.id}-${partnerId}`);
            partnerTeacher = teachers
              .slice()
              .sort((a, b) => teacherSubjectPriority(a, partnerId, cls.id) - teacherSubjectPriority(b, partnerId, cls.id))
              .find((t) => {
                if (usedPartnerIds.has(t.id)) return false;
                if (lockedPartner !== undefined && t.id !== lockedPartner) return false;
                if (!canTeachSubject(t, partnerId)) return false;
                const ts = teacherStates.get(t.id)!;
                if (effectiveHours(t) <= ts.assignedHours) return false;
                if (!isTeacherAvailableOnDay(t, day)) return false;
                if (!isTeacherAvailableAtSlot(t, slot)) return false;
                return !ts.busySlots.has(sk);
              });
            if (!partnerTeacher) continue; // hard constraint: can't place without leader's partner
            usedPartnerIds.add(partnerTeacher.id);
          }

          // Follower classes — each needs its own distinct partner teacher
          if (followerClasses.length > 0) {
            let followersOk = true;
            for (const { cls: fCls } of followerClasses) {
              const fPartnerAss = assignments.find(
                (a) => a.cls.id === fCls.id && a.subject.id === partnerId && a.remaining > 0,
              );
              if (!fPartnerAss) continue; // no partner assignment for this follower, skip
              const fLockedPartner = classSubjectTeacher.get(`${fCls.id}-${partnerId}`);
              const fPT = teachers
                .slice()
                .sort((a, b) => teacherSubjectPriority(a, partnerId, fCls.id) - teacherSubjectPriority(b, partnerId, fCls.id))
                .find((t) => {
                  if (usedPartnerIds.has(t.id)) return false;
                  if (fLockedPartner !== undefined && t.id !== fLockedPartner) return false;
                  if (!canTeachSubject(t, partnerId)) return false;
                  const ts = teacherStates.get(t.id)!;
                  if (effectiveHours(t) <= ts.assignedHours) return false;
                  if (!isTeacherAvailableOnDay(t, day)) return false;
                  if (!isTeacherAvailableAtSlot(t, slot)) return false;
                  return !ts.busySlots.has(sk);
                });
              if (!fPT) { followersOk = false; break; }
              usedPartnerIds.add(fPT.id);
              followerPartnerTeachers.set(fCls.id, fPT);
            }
            if (!followersOk) continue; // can't find distinct partner teacher for every coupled class
          }
        }

        // Lock this teacher to this class+subject pair on first placement
        if (!classSubjectTeacher.has(csKey)) {
          classSubjectTeacher.set(csKey, teacher.id);
        }

        // Helper: record one placed lesson for a class+subject+teacher at (day, slot)
        const recordPlacement = (
          targetCls: SchoolClass,
          targetState: ClassState,
          subj: Subject,
          t: Teacher,
          countTeacherHour: boolean,
        ) => {
          const tState = teacherStates.get(t.id)!;
          const gc = subj.grade_configs.find((g) => g.grade_level === targetCls.grade_level);
          const cat = gc?.category_override ?? subj.category;
          const ag = isAgAssignment(subj, targetCls.grade_level);

          entries.push({
            class_id: targetCls.id,
            subject_id: subj.id,
            teacher_id: t.id,
            day,
            slot,
            is_double_staffed: false,
            class_name: targetCls.name,
            subject_name: subj.name,
            teacher_abbreviation: t.abbreviation,
            teacher_name: `${t.first_name} ${t.last_name}`,
          });

          if (countTeacherHour) {
            tState.assignedHours++;
            if (cat === "main") tState.mainHours++;
            else if (cat === "activity") tState.agHours++;
            else tState.minorHours++;
          }
          tState.busySlots.add(sk);
          targetState.slots.add(sk);
          targetState.slotsPerDay.set(day, (targetState.slotsPerDay.get(day) ?? 0) + 1);
          if (!ag) {
            targetState.nonAgSlotsPerDay.set(day, (targetState.nonAgSlotsPerDay.get(day) ?? 0) + 1);
          }
          targetState.hoursAssigned.set(subj.id, (targetState.hoursAssigned.get(subj.id) ?? 0) + 1);
          const sdKey = `${subj.id}-${day}`;
          if (!targetState.subjectDaySlots.has(sdKey)) targetState.subjectDaySlots.set(sdKey, new Set());
          targetState.subjectDaySlots.get(sdKey)!.add(slot);
          if (!subjectGlobalSlots.has(subj.id)) subjectGlobalSlots.set(subj.id, new Set());
          subjectGlobalSlots.get(subj.id)!.add(sk);
        };

        // Place the primary lesson (leader class)
        recordPlacement(cls, classState, subject, teacher, true);

        // ── Place follower classes (coupled group, same teacher, one hour credit) ──
        for (const { cls: fCls, state: fState } of followerClasses) {
          recordPlacement(fCls, fState, subject, teacher, false);
          // Decrement the follower assignment's remaining count
          const fAssignment = assignments.find(
            (a) => a.cls.id === fCls.id && a.subject.id === subject.id,
          );
          if (fAssignment) fAssignment.remaining--;
        }

        // ── Place partner subject for leader + all follower classes ─────────────
        // Each class gets its own distinct partner teacher at the same slot.
        if (partnerId !== null) {
          const partnerSubject = subjects.find((s) => s.id === partnerId)!;

          // Leader class
          if (partnerTeacher) {
            const pCsKey = `${cls.id}-${partnerId}`;
            if (!classSubjectTeacher.has(pCsKey)) classSubjectTeacher.set(pCsKey, partnerTeacher.id);
            recordPlacement(cls, classState, partnerSubject, partnerTeacher, true);
            const pAss = assignments.find((a) => a.cls.id === cls.id && a.subject.id === partnerId);
            if (pAss) pAss.remaining--;
          }

          // Follower classes
          for (const { cls: fCls, state: fState } of followerClasses) {
            const fPT = followerPartnerTeachers.get(fCls.id);
            if (!fPT) continue;
            const fPCsKey = `${fCls.id}-${partnerId}`;
            if (!classSubjectTeacher.has(fPCsKey)) classSubjectTeacher.set(fPCsKey, fPT.id);
            recordPlacement(fCls, fState, partnerSubject, fPT, true);
            const fPAss = assignments.find((a) => a.cls.id === fCls.id && a.subject.id === partnerId);
            if (fPAss) fPAss.remaining--;
          }
        }

        remaining--;
        assignment.remaining = remaining; // keep object in sync so partner checks see updated value
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
        const gapA = teacherSlotGapScore(teacherStates.get(a.id)!, entry.day as Weekday, entry.slot);
        const gapB = teacherSlotGapScore(teacherStates.get(b.id)!, entry.day as Weekday, entry.slot);
        if (gapA !== gapB) return gapA - gapB;
        // Fairness: prefer teachers who have received fewer double-staffing hours so far,
        // normalised by capacity so part-time teachers are treated proportionally.
        const stateA = teacherStates.get(a.id)!;
        const stateB = teacherStates.get(b.id)!;
        const doubleRatioA = stateA.doubleHours / (effectiveHours(a) || 1);
        const doubleRatioB = stateB.doubleHours / (effectiveHours(b) || 1);
        return doubleRatioA - doubleRatioB;
      });

    if (availableTeachers.length > 0) {
      const secondTeacher = availableTeachers[0];
      const ts = teacherStates.get(secondTeacher.id)!;
      entry.is_double_staffed = true;
      entry.second_teacher_id = secondTeacher.id;
      entry.second_teacher_abbreviation = secondTeacher.abbreviation;
      entry.second_teacher_name = `${secondTeacher.first_name} ${secondTeacher.last_name}`;
      ts.assignedHours++;
      ts.doubleHours++;
      ts.busySlots.add(slotKey(entry.day, entry.slot));
    }
  }

  void warnings;
}
