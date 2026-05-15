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
  // Run up to 50 times with different random orderings; keep the best result.
  let best: SchedulerResult | null = null;
  for (let attempt = 0; attempt < 50; attempt++) {
    const result = _runScheduler(teachers, classes, subjects, gradeLevelConfigs);
    if (!best || result.warnings.length < best.warnings.length) best = result;
    if (best.warnings.length === 0) break;
  }
  return best!;
}

function _runScheduler(
  teachers: Teacher[],
  classes: SchoolClass[],
  subjects: Subject[],
  gradeLevelConfigs: GradeLevelConfig[],
): SchedulerResult {
  const warnings: string[] = [];
  const entries: Omit<TimetableEntry, "id" | "timetable_id">[] = [];

  // Shuffle class order so each attempt explores a different leader/follower assignment
  // for coupled groups and a different slot-competition order across grades.
  const workingClasses = shuffle([...classes]);

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
  for (const cls of workingClasses) {
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
    // Boundary subjects (Randstunden) sort after regular subjects but before AGs
    const isBoundA = !isAgA && a.subject.must_be_boundary;
    const isBoundB = !isAgB && b.subject.must_be_boundary;
    if (isBoundA !== isBoundB) return isBoundA ? 1 : -1;
    // Ultra-constrained: coupled group WITH slot restriction — must be placed absolutely first
    // so that no other subject (even a designated one) can claim their required slots.
    const isUCA = a.subject.coupled_class_ids.length > 0 && a.subject.allowed_slots.length > 0;
    const isUCB = b.subject.coupled_class_ids.length > 0 && b.subject.allowed_slots.length > 0;
    if (isUCA !== isUCB) return isUCA ? -1 : 1;
    // Coupled + partner: must drive before the partner's designated teachers fill slots.
    // Without this, the partner (e.g. Deutsch) sorts first via the designation check below
    // and independently co-places the coupled subject per-class with different teachers.
    const isCPA = a.subject.coupled_class_ids.length > 0 && a.subject.parallel_partner_subject_ids.length > 0;
    const isCPB = b.subject.coupled_class_ids.length > 0 && b.subject.parallel_partner_subject_ids.length > 0;
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

  // ── Round-robin main scheduling loop ────────────────────────────────────────
  // Each outer iteration places at most ONE hour per assignment, cycling through
  // all assignments before repeating. This prevents highly-constrained assignments
  // from monopolising teacher slots before later assignments have had a chance to
  // claim their few valid positions. The loop exits when no assignment makes
  // progress in a full cycle (either all placed or truly stuck).
  let mainLoopProgress = true;
  while (mainLoopProgress) {
    mainLoopProgress = false;

  for (const assignment of assignments) {
    const { cls, subject } = assignment;

    // Skip follower assignments in coupled groups — handled by the group leader
    if (coupledFollowers.has(`${cls.id}-${subject.id}`)) continue;

    // Skip if this assignment is already fully placed
    if (assignment.remaining <= 0) continue;

    // Skip partner assignments driven by a lower-ID subject in the parallel group.
    // Exception: if this subject has coupled_class_ids but the driver does not, this
    // subject must always drive so the coupled group is handled by a single leader pass.
    // Second exception: if remaining > 0 the driver failed to co-place us (e.g. because
    // not all partners were available simultaneously); process independently in that case.
    if (subject.parallel_partner_subject_ids.length > 0) {
      const drivingPartner = subjects.find(
        (s) => s.id < subject.id && s.parallel_partner_subject_ids.includes(subject.id),
      );
      if (drivingPartner) {
        const thisCoupled = subject.coupled_class_ids.length > 0;
        const partnerCoupled = drivingPartner.coupled_class_ids.length > 0;
        if (!(thisCoupled && !partnerCoupled)) {
          // Only skip if the driver already placed us (remaining = 0).
          // If remaining > 0 the driver skipped co-placement; schedule independently.
          if (assignment.remaining === 0) continue;
        }
      }
    }

    const classState = classStates.get(cls.id)!;
    const allowedDays = getSubjectAllowedDays(subject);
    const gradeMaxSlot = maxHoursPerDayByGrade.get(cls.grade_level) ?? 6;
    const gradeMinSlot = minHoursPerDayByGrade.get(cls.grade_level) ?? 4;
    const allowedSlots = getSubjectAllowedSlots(subject, gradeMaxSlot);
    const csKey = `${cls.id}-${subject.id}`;

    const isAg = isAgAssignment(subject, cls.grade_level);
    const isBoundary = !isAg && subject.must_be_boundary;

    {
      // Read the lock fresh every round so it takes effect from the 2nd hour onward
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
      } else if (isBoundary) {
        // Randstunden: must be placed at the edge of the day (first or last slot).
        // Unlike AGs they count as regular lessons and don't require the min to be met first.
        for (const day of shuffle(allowedDays)) {
          const totalCount = classState.slotsPerDay.get(day) ?? 0;
          if (totalCount >= gradeMaxSlot) continue;

          const daySlotNums: number[] = [];
          for (const key of classState.slots) {
            const [d, s] = key.split("-").map(Number);
            if (d === day) daySlotNums.push(s);
          }
          const globalSlots = subjectGlobalSlots.get(subject.id);
          const excluded = mutualExclusions.get(subject.id);
          const isBlocked = (sk: string) =>
            (subject.no_parallel_classes && !!globalSlots?.has(sk)) ||
            !!(excluded && [...excluded].some((id) => subjectGlobalSlots.get(id)?.has(sk)));

          if (daySlotNums.length === 0) {
            // No lessons yet on this day — slot 1 is implicitly a boundary
            const sk = slotKey(day, 1);
            if (!classState.slots.has(sk) && (subject.allowed_slots.length === 0 || subject.allowed_slots.includes(1)) && !isBlocked(sk)) {
              candidateSlots.push({ day, slot: 1 });
            }
          } else {
            const minSl = Math.min(...daySlotNums);
            const maxSl = Math.max(...daySlotNums);
            for (const slot of [minSl - 1, maxSl + 1]) {
              if (slot < 1 || slot > gradeMaxSlot) continue;
              if (subject.allowed_slots.length > 0 && !subject.allowed_slots.includes(slot)) continue;
              const sk = slotKey(day, slot);
              if (classState.slots.has(sk)) continue;
              if (isBlocked(sk)) continue;
              candidateSlots.push({ day, slot });
            }
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
      const sortTeachers = (list: Teacher[]) =>
        list.sort((a, b) => {
          if (lockedTeacherId !== undefined) {
            if (a.id === lockedTeacherId && b.id !== lockedTeacherId) return -1;
            if (b.id === lockedTeacherId && a.id !== lockedTeacherId) return 1;
          }
          const prioA = teacherSubjectPriority(a, subject.id, cls.id);
          const prioB = teacherSubjectPriority(b, subject.id, cls.id);
          if (prioA !== prioB) return prioA - prioB;
          const stateA = teacherStates.get(a.id)!;
          const stateB = teacherStates.get(b.id)!;
          const freesA = countTeacherFreePeriods(stateA);
          const freesB = countTeacherFreePeriods(stateB);
          if (freesA !== freesB) return freesA - freesB;
          const capA = effectiveHours(a) || 1;
          const capB = effectiveHours(b) || 1;
          const loadA = (stateA.mainHours * 3 + stateA.minorHours + stateA.agHours) / capA;
          const loadB = (stateB.mainHours * 3 + stateB.minorHours + stateB.agHours) / capB;
          if (Math.abs(loadA - loadB) > 0.05) return loadA - loadB;
          return (effectiveHours(b) - stateB.assignedHours) - (effectiveHours(a) - stateA.assignedHours);
        });

      // Build initial eligible list respecting the teacher lock.
      let eligibleTeachers = sortTeachers(
        shuffle(teachers).filter((t) => {
          if (lockedTeacherId !== undefined) {
            return (
              t.id === lockedTeacherId &&
              effectiveHours(t) > (teacherStates.get(t.id)?.assignedHours ?? 0)
            );
          }
          if (!canTeachSubject(t, subject.id)) return false;
          if (effectiveHours(t) <= (teacherStates.get(t.id)?.assignedHours ?? 0)) return false;
          return true;
        }),
      );

      // Lock-relaxation: if the locked teacher is exhausted OR busy at every candidate slot,
      // fall back to any eligible teacher (locked teacher still sorted first for consistency).
      if (lockedTeacherId !== undefined) {
        const lockedT = teachers.find((t) => t.id === lockedTeacherId);
        const lockedExhausted = !lockedT ||
          effectiveHours(lockedT) <= (teacherStates.get(lockedTeacherId)?.assignedHours ?? 0);
        const lockedBusy = !lockedExhausted && !candidateSlots.some(({ day: cd, slot: cs }) => {
          const ts = teacherStates.get(lockedTeacherId)!;
          return (
            !ts.busySlots.has(slotKey(cd, cs)) &&
            isTeacherAvailableOnDay(lockedT!, cd) &&
            isTeacherAvailableAtSlot(lockedT!, cs)
          );
        });
        if (lockedExhausted || lockedBusy) {
          eligibleTeachers = sortTeachers(
            shuffle(teachers).filter((t) => {
              if (!canTeachSubject(t, subject.id)) return false;
              if (effectiveHours(t) <= (teacherStates.get(t.id)?.assignedHours ?? 0)) return false;
              return true;
            }),
          );
        }
      }

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

        const partnerIds = subject.parallel_partner_subject_ids;
        // Coupled subjects must always be placed (their slot is constrained); partner
        // co-placement is best-effort. Non-coupled subjects use a hard constraint:
        // skip this slot if any partner subject cannot be co-placed.
        const isCoupledSubject = subject.coupled_class_ids.length > 0;

        const teacher = eligibleTeachers.find((t) => {
          if (!isTeacherAvailableOnDay(t, day)) return false;
          if (!isTeacherAvailableAtSlot(t, slot)) return false;
          const ts = teacherStates.get(t.id)!;
          return !ts.busySlots.has(sk);
        });

        if (!teacher) continue;

        // Re-resolve partner teachers for all partner subjects, leader + follower classes.
        // Rule: all-or-nothing PER CLASS — each class independently gets either ALL partners
        // co-placed or NONE. usedPartnerIds is committed only when every partner for a class
        // is found (tentative reservation prevents double-booking across classes).
        // Non-coupled primaries: hard constraint — skip slot if the leader class can't get all partners.
        // Coupled primaries: primary is always placed; per-class partner co-placement is best-effort.
        const leaderPartnerTeachers = new Map<number, Teacher>();
        const followerPartnerTeachers = new Map<number, Map<number, Teacher>>();
        if (partnerIds.length > 0) {
          const usedPartnerIds = new Set<number>([teacher.id]);

          // Helper: try to find all partner teachers for one class.
          // Uses tentative reservation so usedPartnerIds is only updated on full success.
          // Returns the map of pId→teacher on success, null on failure (any partner missing).
          const resolvePartnersForClass = (targetClsId: number): Map<number, Teacher> | null => {
            const tentative = new Map<number, Teacher>();
            const tentativeIds: number[] = [];
            for (const pId of partnerIds) {
              const pAss = assignments.find((a) => a.cls.id === targetClsId && a.subject.id === pId);
              if (!pAss || pAss.remaining <= 0) continue; // already placed, no need to co-place
              const locked = classSubjectTeacher.get(`${targetClsId}-${pId}`);
              const pt = shuffle(teachers)
                .sort((a, b) => teacherSubjectPriority(a, pId, targetClsId) - teacherSubjectPriority(b, pId, targetClsId))
                .find((t) => {
                  if (usedPartnerIds.has(t.id)) return false;
                  if (tentativeIds.includes(t.id)) return false;
                  if (locked !== undefined && t.id !== locked) return false;
                  if (!canTeachSubject(t, pId)) return false;
                  const ts = teacherStates.get(t.id)!;
                  if (effectiveHours(t) <= ts.assignedHours) return false;
                  if (!isTeacherAvailableOnDay(t, day)) return false;
                  if (!isTeacherAvailableAtSlot(t, slot)) return false;
                  return !ts.busySlots.has(sk);
                });
              if (pt) {
                tentative.set(pId, pt);
                tentativeIds.push(pt.id);
              } else {
                return null; // partner unavailable for this class → skip co-placement
              }
            }
            // All partners found — commit reservations
            for (const id of tentativeIds) usedPartnerIds.add(id);
            return tentative;
          };

          // Leader class
          const leaderResult = resolvePartnersForClass(cls.id);
          if (leaderResult) {
            for (const [k, v] of leaderResult) leaderPartnerTeachers.set(k, v);
          } else if (!isCoupledSubject) {
            continue; // hard constraint: skip slot entirely
          }
          // Coupled + no leader partners → primary placed alone, partners get independent pass

          // Follower classes
          if (followerClasses.length > 0) {
            let followersOk = true;
            for (const { cls: fCls } of followerClasses) {
              const fResult = resolvePartnersForClass(fCls.id);
              if (fResult) {
                followerPartnerTeachers.set(fCls.id, fResult);
              } else if (!isCoupledSubject) {
                followersOk = false; break;
              }
              // Coupled + no follower partners for this class → this class gets primary alone
            }
            if (!isCoupledSubject && !followersOk) continue;
          }
        }

        // Lock (or update) this teacher to this class+subject pair.
        // If a fallback teacher was used (lock relaxation), update so subsequent hours
        // of the same subject for the same class use the same teacher consistently.
        classSubjectTeacher.set(csKey, teacher.id);

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

        // ── Place all partner subjects for leader + follower classes ──────────
        if (partnerIds.length > 0) {
          for (const pId of partnerIds) {
            const partnerSubject = subjects.find((s) => s.id === pId);
            if (!partnerSubject) continue;

            // Leader class
            const pTeacher = leaderPartnerTeachers.get(pId);
            if (pTeacher) {
              const pCsKey = `${cls.id}-${pId}`;
              if (!classSubjectTeacher.has(pCsKey)) classSubjectTeacher.set(pCsKey, pTeacher.id);
              recordPlacement(cls, classState, partnerSubject, pTeacher, true);
              const pAss = assignments.find((a) => a.cls.id === cls.id && a.subject.id === pId);
              if (pAss) pAss.remaining--;
            }

            // Follower classes
            for (const { cls: fCls, state: fState } of followerClasses) {
              const fPT = followerPartnerTeachers.get(fCls.id)?.get(pId);
              if (!fPT) continue;
              const fPCsKey = `${fCls.id}-${pId}`;
              if (!classSubjectTeacher.has(fPCsKey)) classSubjectTeacher.set(fPCsKey, fPT.id);
              recordPlacement(fCls, fState, partnerSubject, fPT, true);
              const fPAss = assignments.find((a) => a.cls.id === fCls.id && a.subject.id === pId);
              if (fPAss) fPAss.remaining--;
            }
          }
        }

        assignment.remaining--;
        placed = true;
        break;
      }

      if (placed) mainLoopProgress = true;
    }
  }

  } // end while (mainLoopProgress)

  // Diagnose why an assignment could not be placed (called only for unresolved warnings).
  const diagnoseFailure = (assignment: { cls: SchoolClass; subject: Subject; remaining: number; gradeLevel: GradeLevel }): string => {
    const { cls: dCls, subject: dSubj } = assignment;
    const dState = classStates.get(dCls.id)!;
    const dGradeMax = maxHoursPerDayByGrade.get(dCls.grade_level) ?? 6;
    const dGradeMin = minHoursPerDayByGrade.get(dCls.grade_level) ?? 4;
    const dIsAg = isAgAssignment(dSubj, dCls.grade_level);
    const dCsKey = `${dCls.id}-${dSubj.id}`;
    const dLockedId = classSubjectTeacher.get(dCsKey);
    const dAllowedDays = getSubjectAllowedDays(dSubj);
    const dAllowedSlots = getSubjectAllowedSlots(dSubj, dGradeMax);

    const eligible = teachers.filter((t) => {
      if (dLockedId !== undefined) return t.id === dLockedId;
      return canTeachSubject(t, dSubj.id);
    });
    if (eligible.length === 0) return "Keine Lehrkraft für dieses Fach konfiguriert.";

    const withCapacity = eligible.filter((t) => effectiveHours(t) > (teacherStates.get(t.id)?.assignedHours ?? 0));
    if (withCapacity.length === 0) {
      const abbrs = eligible.map((t) => t.abbreviation).join(", ");
      return `Lehrkraft-Kapazität erschöpft (${abbrs}).`;
    }

    let anyValidDay = false;
    let anyFreeClassSlot = false;
    let anyFreeTeacherSlot = false;
    let blockedByParallel = false;

    for (const day of dAllowedDays) {
      const dayTotal = dState.slotsPerDay.get(day) ?? 0;
      if (dayTotal >= dGradeMax) continue;
      if (dIsAg) {
        const nonAg = dState.nonAgSlotsPerDay.get(day) ?? 0;
        if (nonAg < dGradeMin) continue;
      }
      anyValidDay = true;

      for (const slot of dAllowedSlots) {
        const sk = slotKey(day, slot);
        if (dState.slots.has(sk)) continue;
        anyFreeClassSlot = true;

        const globalSlots = subjectGlobalSlots.get(dSubj.id);
        const excluded = mutualExclusions.get(dSubj.id);
        const isParallelBlocked =
          (dSubj.no_parallel_classes && !!globalSlots?.has(sk)) ||
          !!(excluded && [...excluded].some((id) => subjectGlobalSlots.get(id)?.has(sk)));
        if (isParallelBlocked) { blockedByParallel = true; continue; }

        for (const t of withCapacity) {
          const ts = teacherStates.get(t.id)!;
          if (isTeacherAvailableOnDay(t, day) && isTeacherAvailableAtSlot(t, slot) && !ts.busySlots.has(sk)) {
            anyFreeTeacherSlot = true;
            break;
          }
        }
        if (anyFreeTeacherSlot) break;
      }
      if (anyFreeTeacherSlot) break;
    }

    if (!anyValidDay) {
      return dIsAg
        ? "Kein Wochentag hat genug Pflicht-Stunden für AG-Platzierung (Minimum noch nicht erreicht)."
        : "Keine erlaubten Wochentage mehr verfügbar (alle voll belegt).";
    }
    if (!anyFreeClassSlot && blockedByParallel) return "Alle verfügbaren Slots durch Parallelunterricht-Einschränkung blockiert.";
    if (!anyFreeClassSlot) return "Alle erlaubten Unterrichtsstunden für diese Klasse sind bereits belegt.";
    if (blockedByParallel) return `Lehrkraft (${withCapacity.map((t) => t.abbreviation).join(", ")}) zur selben Zeit anderweitig verplant; freie Slots durch Parallelunterricht blockiert.`;
    return `Lehrkraft (${withCapacity.map((t) => t.abbreviation).join(", ")}) zur selben Zeit in einer anderen Klasse eingeplant.`;
  };

  // Emit warnings for assignments that could not be fully placed.
  for (const assignment of assignments) {
    if (assignment.remaining <= 0) continue;
    const { cls, subject } = assignment;
    if (coupledFollowers.has(`${cls.id}-${subject.id}`)) continue;
    // Only warn for assignments that are responsible for placing themselves
    // (partners driven by a lower-ID subject emit no independent warning).
    if (subject.parallel_partner_subject_ids.length > 0) {
      const drivingPartner = subjects.find(
        (s) => s.id < subject.id && s.parallel_partner_subject_ids.includes(subject.id),
      );
      if (drivingPartner) {
        const thisCoupled = subject.coupled_class_ids.length > 0;
        const partnerCoupled = drivingPartner.coupled_class_ids.length > 0;
        if (!(thisCoupled && !partnerCoupled)) continue;
      }
    }
    const reason = diagnoseFailure(assignment);
    warnings.push(
      `Klasse "${cls.name}", Fach "${subject.name}": ${assignment.remaining} Stunde(n) nicht einplanbar. ${reason}`,
    );
  }

  // ── Repair phase ──────────────────────────────────────────────────────────────
  // For each still-unplaced assignment, try to free up a valid slot by moving a
  // blocking entry (the teacher's existing lesson at that slot) to another location.
  // Runs up to 5 rounds or until no further progress can be made.

  // Returns true if removing `slot` from `day` and adding `toSlot` on `toDay` for
  // the given class both preserve the no-free-periods consecutive block invariant.
  const repairMoveOk = (
    blockClassState: ClassState,
    blockCls: SchoolClass,
    fromDay: Weekday, fromSlot: number,
    toDay: Weekday, toSlot: number,
  ): boolean => {
    if (blockCls.allow_free_periods) return true;
    const consecutive = (nums: number[]) => {
      if (nums.length <= 1) return true;
      const s = [...nums].sort((a, b) => a - b);
      return s.every((v, i) => i === 0 || v === s[i - 1] + 1);
    };
    // After removal from fromDay
    const afterRemoval: number[] = [];
    for (const key of blockClassState.slots) {
      const [d, s] = key.split("-").map(Number);
      if (d === fromDay && s !== fromSlot) afterRemoval.push(s);
    }
    if (!consecutive(afterRemoval)) return false;
    // After addition to toDay
    const afterAdd: number[] = [];
    for (const key of blockClassState.slots) {
      const [d, s] = key.split("-").map(Number);
      if (d === toDay) afterAdd.push(s);
    }
    afterAdd.push(toSlot);
    return consecutive(afterAdd);
  };

  // Standalone record helper used by the repair phase (takes explicit day/slot).
  const repairRecord = (
    targetCls: SchoolClass,
    targetState: ClassState,
    subj: Subject,
    t: Teacher,
    rDay: Weekday,
    rSlot: number,
    countTeacherHour: boolean,
  ) => {
    const rSk = slotKey(rDay, rSlot);
    const tState = teacherStates.get(t.id)!;
    const gc = subj.grade_configs.find((g) => g.grade_level === targetCls.grade_level);
    const cat = gc?.category_override ?? subj.category;
    const ag = isAgAssignment(subj, targetCls.grade_level);
    entries.push({
      class_id: targetCls.id, subject_id: subj.id, teacher_id: t.id,
      day: rDay, slot: rSlot, is_double_staffed: false,
      class_name: targetCls.name, subject_name: subj.name,
      teacher_abbreviation: t.abbreviation, teacher_name: `${t.first_name} ${t.last_name}`,
    });
    if (countTeacherHour) {
      tState.assignedHours++;
      if (cat === "main") tState.mainHours++;
      else if (cat === "activity") tState.agHours++;
      else tState.minorHours++;
    }
    tState.busySlots.add(rSk);
    targetState.slots.add(rSk);
    targetState.slotsPerDay.set(rDay, (targetState.slotsPerDay.get(rDay) ?? 0) + 1);
    if (!ag) targetState.nonAgSlotsPerDay.set(rDay, (targetState.nonAgSlotsPerDay.get(rDay) ?? 0) + 1);
    targetState.hoursAssigned.set(subj.id, (targetState.hoursAssigned.get(subj.id) ?? 0) + 1);
    const sdKey = `${subj.id}-${rDay}`;
    if (!targetState.subjectDaySlots.has(sdKey)) targetState.subjectDaySlots.set(sdKey, new Set());
    targetState.subjectDaySlots.get(sdKey)!.add(rSlot);
    if (!subjectGlobalSlots.has(subj.id)) subjectGlobalSlots.set(subj.id, new Set());
    subjectGlobalSlots.get(subj.id)!.add(rSk);
  };

  for (let repairRound = 0; repairRound < 10; repairRound++) {
    let anyProgress = false;

    for (const assignment of shuffle(assignments.slice())) {
      if (assignment.remaining <= 0) continue;
      if (coupledFollowers.has(`${assignment.cls.id}-${assignment.subject.id}`)) continue;

      const { cls, subject } = assignment;
      const classState = classStates.get(cls.id)!;
      const gradeMaxSlot = maxHoursPerDayByGrade.get(cls.grade_level) ?? 6;
      const allowedDays = getSubjectAllowedDays(subject);
      const allowedSlots = getSubjectAllowedSlots(subject, gradeMaxSlot);
      const isAg = isAgAssignment(subject, cls.grade_level);
      const isBoundary = !isAg && subject.must_be_boundary;
      const csKey = `${cls.id}-${subject.id}`;
      const lockedTeacherId = classSubjectTeacher.get(csKey);

      let placed = false;

      for (const targetDay of shuffle(allowedDays)) {
        if (placed) break;
        const totalDayCount = classState.slotsPerDay.get(targetDay) ?? 0;
        if (totalDayCount >= gradeMaxSlot) continue;
        const sdKey = `${subject.id}-${targetDay}`;
        if (subject.no_repeat_per_day && (classState.subjectDaySlots.get(sdKey) ?? new Set()).size > 0) continue;

        // Determine candidate target slots (mirrors main-loop logic)
        const targetSlots: number[] = [];
        if (isBoundary || isAg) {
          // AGs require the day to already have enough non-AG lessons (same rule as main loop)
          if (isAg) {
            const nonAgCount = classState.nonAgSlotsPerDay.get(targetDay) ?? 0;
            const gradeMin = minHoursPerDayByGrade.get(cls.grade_level) ?? 4;
            if (nonAgCount < gradeMin) continue;
          }
          const dayNums: number[] = [];
          for (const key of classState.slots) {
            const [d, s] = key.split("-").map(Number);
            if (d === targetDay) dayNums.push(s);
          }
          if (dayNums.length === 0) {
            // AGs cannot be placed on a day with no existing lessons (they need a boundary to attach to)
            if (!isAg && allowedSlots.includes(1)) targetSlots.push(1);
          } else {
            const minS = Math.min(...dayNums);
            const maxS = Math.max(...dayNums);
            if (minS - 1 >= 1 && allowedSlots.includes(minS - 1)) targetSlots.push(minS - 1);
            if (maxS + 1 <= gradeMaxSlot && allowedSlots.includes(maxS + 1)) targetSlots.push(maxS + 1);
          }
        } else if (!cls.allow_free_periods) {
          let dayMin = Infinity;
          for (const key of classState.slots) {
            const [d, s] = key.split("-").map(Number);
            if (d === targetDay) dayMin = Math.min(dayMin, s);
          }
          const effectiveStart = dayMin === Infinity ? 1 : dayMin;
          const nextSlot = effectiveStart + totalDayCount;
          if (nextSlot <= gradeMaxSlot && allowedSlots.includes(nextSlot)) targetSlots.push(nextSlot);
          if (dayMin !== Infinity && dayMin - 1 >= 1 && allowedSlots.includes(dayMin - 1)) targetSlots.push(dayMin - 1);
        } else {
          for (const s of allowedSlots) {
            if (s <= gradeMaxSlot) targetSlots.push(s);
          }
        }

        for (const targetSlot of targetSlots) {
          if (placed) break;
          const targetSk = slotKey(targetDay, targetSlot);

          // Case D: target slot is occupied by a different subject for this class.
          // Try to move that blocking class entry to an alternative slot, then place here.
          if (classState.slots.has(targetSk)) {
            const dBlockIdx = entries.findIndex(
              (e) => e.class_id === cls.id && e.day === targetDay && e.slot === targetSlot,
            );
            if (dBlockIdx < 0) continue;
            const dBlock = entries[dBlockIdx];
            const dSubj = subjects.find((s) => s.id === dBlock.subject_id);
            if (!dSubj) continue;
            if (dSubj.coupled_class_ids.length > 0) continue;
            if (dSubj.parallel_partner_subject_ids.length > 0) continue;
            const dTeacher = teachers.find((t) => t.id === dBlock.teacher_id);
            if (!dTeacher) continue;
            const dTState = teacherStates.get(dTeacher.id)!;
            const dAllowedDays = getSubjectAllowedDays(dSubj);
            const dAllowedSlots = getSubjectAllowedSlots(dSubj, gradeMaxSlot);
            // Require a teacher for U at targetSk (check before committing to the move)
            const uTeacher = shuffle(teachers).find((t) => {
              if (lockedTeacherId !== undefined && t.id !== lockedTeacherId) return false;
              if (!canTeachSubject(t, subject.id)) return false;
              const ts = teacherStates.get(t.id)!;
              if (effectiveHours(t) <= ts.assignedHours) return false;
              if (!isTeacherAvailableOnDay(t, targetDay)) return false;
              if (!isTeacherAvailableAtSlot(t, targetSlot)) return false;
              return !ts.busySlots.has(targetSk) || t.id === dTeacher.id;
            }) ?? shuffle(teachers).find((t) => {
              if (!canTeachSubject(t, subject.id)) return false;
              const ts = teacherStates.get(t.id)!;
              if (effectiveHours(t) <= ts.assignedHours) return false;
              if (!isTeacherAvailableOnDay(t, targetDay)) return false;
              if (!isTeacherAvailableAtSlot(t, targetSlot)) return false;
              return !ts.busySlots.has(targetSk) || t.id === dTeacher.id;
            });
            if (!uTeacher) continue;
            let dMoved = false;
            outerD: for (const altDay of shuffle(dAllowedDays)) {
              for (const altSlot of dAllowedSlots) {
                if (altDay === targetDay && altSlot === targetSlot) continue;
                const altSk = slotKey(altDay, altSlot);
                if (classState.slots.has(altSk)) continue;
                if (dTState.busySlots.has(altSk)) continue;
                if (altSlot > gradeMaxSlot) continue;
                if ((classState.slotsPerDay.get(altDay) ?? 0) >= gradeMaxSlot) continue;
                if (!isTeacherAvailableOnDay(dTeacher, altDay)) continue;
                if (!isTeacherAvailableAtSlot(dTeacher, altSlot)) continue;
                if (dSubj.no_repeat_per_day) {
                  const altSdKey = `${dSubj.id}-${altDay}`;
                  const onAlt = classState.subjectDaySlots.get(altSdKey) ?? new Set();
                  if (onAlt.size > 0 && altDay !== (dBlock.day as Weekday)) continue;
                }
                if (!repairMoveOk(classState, cls, dBlock.day as Weekday, dBlock.slot, altDay, altSlot)) continue;
                // Also ensure uTeacher is free at targetSk after the move
                if (uTeacher.id === dTeacher.id && altSk === targetSk) continue; // can't move to same spot we need
                const uTs = teacherStates.get(uTeacher.id)!;
                if (uTeacher.id !== dTeacher.id && uTs.busySlots.has(targetSk)) continue;
                // Perform the move of the blocking class entry
                const dFromSk = slotKey(dBlock.day as Weekday, dBlock.slot);
                const dIsAg = isAgAssignment(dSubj, cls.grade_level);
                dTState.busySlots.delete(dFromSk);
                classState.slots.delete(dFromSk);
                classState.slotsPerDay.set(dBlock.day as Weekday, Math.max(0, (classState.slotsPerDay.get(dBlock.day as Weekday) ?? 0) - 1));
                if (!dIsAg) classState.nonAgSlotsPerDay.set(dBlock.day as Weekday, Math.max(0, (classState.nonAgSlotsPerDay.get(dBlock.day as Weekday) ?? 0) - 1));
                const dOldSdk = `${dSubj.id}-${dBlock.day}`;
                classState.subjectDaySlots.get(dOldSdk)?.delete(dBlock.slot);
                subjectGlobalSlots.get(dSubj.id)?.delete(dFromSk);
                entries[dBlockIdx] = { ...entries[dBlockIdx], day: altDay, slot: altSlot };
                dTState.busySlots.add(altSk);
                classState.slots.add(altSk);
                classState.slotsPerDay.set(altDay, (classState.slotsPerDay.get(altDay) ?? 0) + 1);
                if (!dIsAg) classState.nonAgSlotsPerDay.set(altDay, (classState.nonAgSlotsPerDay.get(altDay) ?? 0) + 1);
                const dNewSdk = `${dSubj.id}-${altDay}`;
                if (!classState.subjectDaySlots.has(dNewSdk)) classState.subjectDaySlots.set(dNewSdk, new Set());
                classState.subjectDaySlots.get(dNewSdk)!.add(altSlot);
                if (!subjectGlobalSlots.has(dSubj.id)) subjectGlobalSlots.set(dSubj.id, new Set());
                subjectGlobalSlots.get(dSubj.id)!.add(altSk);
                // Place the unplaced assignment at the now-free slot
                repairRecord(cls, classState, subject, uTeacher, targetDay, targetSlot, true);
                classSubjectTeacher.set(csKey, uTeacher.id);
                assignment.remaining--;
                placed = true;
                anyProgress = true;
                dMoved = true;
                break outerD;
              }
            }
            if (dMoved) break;
            continue; // class slot still occupied, skip
          }

          // Find eligible teachers (respects existing lock, or any eligible if unlocked)
          const repairEligible = shuffle(teachers).filter((t) => {
            if (lockedTeacherId !== undefined && t.id !== lockedTeacherId) return false;
            if (!canTeachSubject(t, subject.id)) return false;
            if (!isTeacherAvailableOnDay(t, targetDay)) return false;
            if (!isTeacherAvailableAtSlot(t, targetSlot)) return false;
            return true;
          });
          // Expand to all eligible if locked teacher isn't available here
          const allEligible = repairEligible.length > 0 ? repairEligible :
            shuffle(teachers).filter((t) => {
              if (!canTeachSubject(t, subject.id)) return false;
              if (!isTeacherAvailableOnDay(t, targetDay)) return false;
              if (!isTeacherAvailableAtSlot(t, targetSlot)) return false;
              return true;
            });

          for (const repairTeacher of allEligible) {
            const rtState = teacherStates.get(repairTeacher.id)!;

            // Case A: teacher is free AND has capacity → direct placement
            if (effectiveHours(repairTeacher) > rtState.assignedHours && !rtState.busySlots.has(targetSk)) {
              repairRecord(cls, classState, subject, repairTeacher, targetDay, targetSlot, true);
              classSubjectTeacher.set(csKey, repairTeacher.id);
              assignment.remaining--;
              placed = true;
              anyProgress = true;
              break;
            }

            // Case B: teacher is busy → try to move the blocking entry
            if (rtState.busySlots.has(targetSk) && effectiveHours(repairTeacher) > rtState.assignedHours) {
              const blockIdx = entries.findIndex(
                (e) => e.teacher_id === repairTeacher.id && e.day === targetDay && e.slot === targetSlot,
              );
              if (blockIdx < 0) continue;
              const block = entries[blockIdx];

              const blockSubject = subjects.find((s) => s.id === block.subject_id);
              const blockClass = classes.find((c) => c.id === block.class_id);
              if (!blockSubject || !blockClass) continue;
              // Don't disturb coupled or partner-group entries (complex cascading effects)
              if (blockSubject.coupled_class_ids.length > 0) continue;
              if (blockSubject.parallel_partner_subject_ids.length > 0) continue;

              const blockClassState = classStates.get(blockClass.id)!;
              const blockGradeMax = maxHoursPerDayByGrade.get(blockClass.grade_level) ?? 6;
              const blockAllowedDays = getSubjectAllowedDays(blockSubject);
              const blockAllowedSlots = getSubjectAllowedSlots(blockSubject, blockGradeMax);

              let altFound = false;
              outer: for (const altDay of shuffle(blockAllowedDays)) {
                for (const altSlot of blockAllowedSlots) {
                  if (altDay === targetDay && altSlot === targetSlot) continue;
                  const altSk = slotKey(altDay, altSlot);
                  if (blockClassState.slots.has(altSk)) continue;
                  if (rtState.busySlots.has(altSk)) continue;
                  if (altSlot > blockGradeMax) continue;
                  if ((blockClassState.slotsPerDay.get(altDay) ?? 0) >= blockGradeMax) continue;
                  if (!isTeacherAvailableOnDay(repairTeacher, altDay)) continue;
                  if (!isTeacherAvailableAtSlot(repairTeacher, altSlot)) continue;
                  if (blockSubject.no_repeat_per_day) {
                    const altSdKey = `${blockSubject.id}-${altDay}`;
                    const existingOnAlt = blockClassState.subjectDaySlots.get(altSdKey) ?? new Set();
                    if (existingOnAlt.size > 0 && altDay !== (block.day as Weekday)) continue;
                  }
                  if (!repairMoveOk(blockClassState, blockClass, block.day as Weekday, block.slot, altDay, altSlot)) continue;

                  // Perform the move
                  const fromSk = slotKey(block.day as Weekday, block.slot);
                  const blockAg = isAgAssignment(blockSubject, blockClass.grade_level);
                  rtState.busySlots.delete(fromSk);
                  blockClassState.slots.delete(fromSk);
                  blockClassState.slotsPerDay.set(block.day as Weekday, Math.max(0, (blockClassState.slotsPerDay.get(block.day as Weekday) ?? 0) - 1));
                  if (!blockAg) blockClassState.nonAgSlotsPerDay.set(block.day as Weekday, Math.max(0, (blockClassState.nonAgSlotsPerDay.get(block.day as Weekday) ?? 0) - 1));
                  const oldSdKey = `${blockSubject.id}-${block.day}`;
                  blockClassState.subjectDaySlots.get(oldSdKey)?.delete(block.slot);
                  subjectGlobalSlots.get(blockSubject.id)?.delete(fromSk);

                  entries[blockIdx] = { ...entries[blockIdx], day: altDay, slot: altSlot };

                  rtState.busySlots.add(altSk);
                  blockClassState.slots.add(altSk);
                  blockClassState.slotsPerDay.set(altDay, (blockClassState.slotsPerDay.get(altDay) ?? 0) + 1);
                  if (!blockAg) blockClassState.nonAgSlotsPerDay.set(altDay, (blockClassState.nonAgSlotsPerDay.get(altDay) ?? 0) + 1);
                  const newSdKey = `${blockSubject.id}-${altDay}`;
                  if (!blockClassState.subjectDaySlots.has(newSdKey)) blockClassState.subjectDaySlots.set(newSdKey, new Set());
                  blockClassState.subjectDaySlots.get(newSdKey)!.add(altSlot);
                  if (!subjectGlobalSlots.has(blockSubject.id)) subjectGlobalSlots.set(blockSubject.id, new Set());
                  subjectGlobalSlots.get(blockSubject.id)!.add(altSk);

                  altFound = true;
                  break outer;
                }
              }
              if (!altFound) continue;

              // Place the unplaced assignment at the now-free slot
              repairRecord(cls, classState, subject, repairTeacher, targetDay, targetSlot, true);
              classSubjectTeacher.set(csKey, repairTeacher.id);
              assignment.remaining--;
              placed = true;
              anyProgress = true;
              break;
            }

            // Case C: teacher is free at this slot but has hit their hours_per_week cap.
            // Try to free one capacity unit by reassigning one of their existing entries
            // to a different eligible teacher — leaving room to place the unplaced assignment.
            if (!rtState.busySlots.has(targetSk) && effectiveHours(repairTeacher) <= rtState.assignedHours) {
              // Find an entry taught by repairTeacher that a different teacher could cover.
              let swapDone = false;
              for (let eIdx = 0; eIdx < entries.length; eIdx++) {
                if (placed) break;
                const e = entries[eIdx];
                if (e.teacher_id !== repairTeacher.id) continue;
                const eSubj = subjects.find((s) => s.id === e.subject_id);
                const eCls  = classes.find((c) => c.id === e.class_id);
                if (!eSubj || !eCls) continue;
                if (eSubj.coupled_class_ids.length > 0) continue;
                if (eSubj.parallel_partner_subject_ids.length > 0) continue;
                const eSk = slotKey(e.day as Weekday, e.slot);
                // Find an alternative teacher who can take over this entry
                const altT = shuffle(teachers).find((t2) => {
                  if (t2.id === repairTeacher.id) return false;
                  if (!isSubjectAllowedForClass(t2, e.subject_id, e.class_id)) return false;
                  const t2s = teacherStates.get(t2.id)!;
                  if (effectiveHours(t2) <= t2s.assignedHours) return false;
                  if (!isTeacherAvailableOnDay(t2, e.day as Weekday)) return false;
                  if (!isTeacherAvailableAtSlot(t2, e.slot)) return false;
                  return !t2s.busySlots.has(eSk);
                });
                if (!altT) continue;
                // Perform the teacher swap on this entry
                const altTs = teacherStates.get(altT.id)!;
                const eGc = eSubj.grade_configs.find((g) => g.grade_level === eCls.grade_level);
                const eCat = eGc?.category_override ?? eSubj.category;
                const eIsAg = isAgAssignment(eSubj, eCls.grade_level);
                // Deduct from repairTeacher
                rtState.assignedHours--;
                if (eCat === "main") rtState.mainHours--;
                else if (eIsAg) rtState.agHours--;
                else rtState.minorHours--;
                rtState.busySlots.delete(eSk);
                // Add to altT
                altTs.assignedHours++;
                if (eCat === "main") altTs.mainHours++;
                else if (eIsAg) altTs.agHours++;
                else altTs.minorHours++;
                altTs.busySlots.add(eSk);
                // Update entry and lock
                entries[eIdx] = {
                  ...entries[eIdx],
                  teacher_id: altT.id,
                  teacher_abbreviation: altT.abbreviation,
                  teacher_name: `${altT.first_name} ${altT.last_name}`,
                };
                const eCsKey = `${e.class_id}-${e.subject_id}`;
                if (classSubjectTeacher.get(eCsKey) === repairTeacher.id) {
                  classSubjectTeacher.set(eCsKey, altT.id);
                }
                swapDone = true;
                // Now repairTeacher has capacity — place the unplaced assignment
                repairRecord(cls, classState, subject, repairTeacher, targetDay, targetSlot, true);
                classSubjectTeacher.set(csKey, repairTeacher.id);
                assignment.remaining--;
                placed = true;
                anyProgress = true;
                break;
              }
              if (swapDone) break;
            }
          }
        }
      }
    }

    if (!anyProgress) break;
  }

  // ── Backtracking pass ─────────────────────────────────────────────────────────
  // For each still-unplaced assignment, attempt depth-2 conflict resolution:
  // move up to two blocking entries to free a (teacher, day, slot) for the stuck assignment.
  // Only simple (non-coupled, non-partner) entries are moved to avoid cascade side-effects.
  // Returns an undo function on success so the caller can reverse if a deeper step fails.
  type UndoFn = () => void;

  const tryMoveEntryBt = (eIdx: number, avoidSk?: string): UndoFn | null => {
    const e = entries[eIdx];
    const eSubj = subjects.find((s) => s.id === e.subject_id);
    const eCls  = classes.find((c) => c.id === e.class_id);
    if (!eSubj || !eCls) return null;
    if (eSubj.coupled_class_ids.length > 0) return null;
    if (eSubj.parallel_partner_subject_ids.length > 0) return null;
    const eT = teachers.find((t) => t.id === e.teacher_id);
    if (!eT) return null;
    const eTs   = teacherStates.get(eT.id)!;
    const eCs   = classStates.get(eCls.id)!;
    const eGMax = maxHoursPerDayByGrade.get(eCls.grade_level) ?? 6;
    const eAD   = getSubjectAllowedDays(eSubj);
    const eAS   = getSubjectAllowedSlots(eSubj, eGMax);
    const fromSk = slotKey(e.day as Weekday, e.slot);

    for (const altDay of shuffle(eAD)) {
      for (const altSlot of eAS) {
        const altSk = slotKey(altDay, altSlot);
        if (altSk === fromSk) continue;
        if (avoidSk && altSk === avoidSk) continue;
        if (eCs.slots.has(altSk)) continue;
        if (eTs.busySlots.has(altSk)) continue;
        if (altSlot > eGMax) continue;
        if ((eCs.slotsPerDay.get(altDay) ?? 0) >= eGMax) continue;
        if (!isTeacherAvailableOnDay(eT, altDay)) continue;
        if (!isTeacherAvailableAtSlot(eT, altSlot)) continue;
        if (eSubj.no_repeat_per_day) {
          const altSdk = `${eSubj.id}-${altDay}`;
          const onAlt = eCs.subjectDaySlots.get(altSdk) ?? new Set();
          if (onAlt.size > 0 && altDay !== (e.day as Weekday)) continue;
        }
        if (!repairMoveOk(eCs, eCls, e.day as Weekday, e.slot, altDay, altSlot)) continue;

        // Perform move
        const eIsAg = isAgAssignment(eSubj, eCls.grade_level);
        eTs.busySlots.delete(fromSk);
        eCs.slots.delete(fromSk);
        eCs.slotsPerDay.set(e.day as Weekday, Math.max(0, (eCs.slotsPerDay.get(e.day as Weekday) ?? 0) - 1));
        if (!eIsAg) eCs.nonAgSlotsPerDay.set(e.day as Weekday, Math.max(0, (eCs.nonAgSlotsPerDay.get(e.day as Weekday) ?? 0) - 1));
        eCs.subjectDaySlots.get(`${eSubj.id}-${e.day}`)?.delete(e.slot);
        subjectGlobalSlots.get(eSubj.id)?.delete(fromSk);
        entries[eIdx] = { ...entries[eIdx], day: altDay, slot: altSlot };
        eTs.busySlots.add(altSk);
        eCs.slots.add(altSk);
        eCs.slotsPerDay.set(altDay, (eCs.slotsPerDay.get(altDay) ?? 0) + 1);
        if (!eIsAg) eCs.nonAgSlotsPerDay.set(altDay, (eCs.nonAgSlotsPerDay.get(altDay) ?? 0) + 1);
        const newSdk = `${eSubj.id}-${altDay}`;
        if (!eCs.subjectDaySlots.has(newSdk)) eCs.subjectDaySlots.set(newSdk, new Set());
        eCs.subjectDaySlots.get(newSdk)!.add(altSlot);
        if (!subjectGlobalSlots.has(eSubj.id)) subjectGlobalSlots.set(eSubj.id, new Set());
        subjectGlobalSlots.get(eSubj.id)!.add(altSk);

        // Return undo function
        return () => {
          eTs.busySlots.delete(altSk);
          eCs.slots.delete(altSk);
          eCs.slotsPerDay.set(altDay, Math.max(0, (eCs.slotsPerDay.get(altDay) ?? 0) - 1));
          if (!eIsAg) eCs.nonAgSlotsPerDay.set(altDay, Math.max(0, (eCs.nonAgSlotsPerDay.get(altDay) ?? 0) - 1));
          eCs.subjectDaySlots.get(newSdk)?.delete(altSlot);
          subjectGlobalSlots.get(eSubj.id)?.delete(altSk);
          entries[eIdx] = { ...entries[eIdx], day: e.day as Weekday, slot: e.slot };
          eTs.busySlots.add(fromSk);
          eCs.slots.add(fromSk);
          eCs.slotsPerDay.set(e.day as Weekday, (eCs.slotsPerDay.get(e.day as Weekday) ?? 0) + 1);
          if (!eIsAg) eCs.nonAgSlotsPerDay.set(e.day as Weekday, (eCs.nonAgSlotsPerDay.get(e.day as Weekday) ?? 0) + 1);
          const oldSdk2 = `${eSubj.id}-${e.day}`;
          if (!eCs.subjectDaySlots.has(oldSdk2)) eCs.subjectDaySlots.set(oldSdk2, new Set());
          eCs.subjectDaySlots.get(oldSdk2)!.add(e.slot);
          if (!subjectGlobalSlots.has(eSubj.id)) subjectGlobalSlots.set(eSubj.id, new Set());
          subjectGlobalSlots.get(eSubj.id)!.add(fromSk);
        };
      }
    }
    return null;
  };

  for (const assignment of shuffle(assignments.slice())) {
    if (assignment.remaining <= 0) continue;
    if (coupledFollowers.has(`${assignment.cls.id}-${assignment.subject.id}`)) continue;

    const { cls: btCls, subject: btSubj } = assignment;
    const btClassState = classStates.get(btCls.id)!;
    const btGradeMax = maxHoursPerDayByGrade.get(btCls.grade_level) ?? 6;
    const btGradeMin = minHoursPerDayByGrade.get(btCls.grade_level) ?? 4;
    const btAllowedDays = getSubjectAllowedDays(btSubj);
    const btAllowedSlots = getSubjectAllowedSlots(btSubj, btGradeMax);
    const btCsKey = `${btCls.id}-${btSubj.id}`;
    const btLockedId = classSubjectTeacher.get(btCsKey);
    const btIsAg = isAgAssignment(btSubj, btCls.grade_level);
    const btIsBoundary = !btIsAg && btSubj.must_be_boundary;

    let btPlaced = false;

    for (const btDay of shuffle(btAllowedDays)) {
      if (btPlaced) break;
      if (btIsAg) {
        const nonAg = btClassState.nonAgSlotsPerDay.get(btDay) ?? 0;
        if (nonAg < btGradeMin) continue;
      }
      if ((btClassState.slotsPerDay.get(btDay) ?? 0) >= btGradeMax) continue;

      // Compute candidate slots (mirrors repair logic)
      const btSlots: number[] = [];
      if (btIsBoundary || btIsAg) {
        const dayNums: number[] = [];
        for (const key of btClassState.slots) {
          const [d, s] = key.split("-").map(Number);
          if (d === btDay) dayNums.push(s);
        }
        if (dayNums.length === 0 && !btIsAg && btAllowedSlots.includes(1)) btSlots.push(1);
        else {
          const minS = Math.min(...dayNums);
          const maxS = Math.max(...dayNums);
          if (minS - 1 >= 1 && btAllowedSlots.includes(minS - 1)) btSlots.push(minS - 1);
          if (maxS + 1 <= btGradeMax && btAllowedSlots.includes(maxS + 1)) btSlots.push(maxS + 1);
        }
      } else {
        for (const s of btAllowedSlots) {
          if (s <= btGradeMax) btSlots.push(s);
        }
      }

      for (const btSlot of shuffle(btSlots)) {
        if (btPlaced) break;
        const btSk = slotKey(btDay, btSlot);

        // Must have a free class slot
        if (btClassState.slots.has(btSk)) continue;

        // Find an eligible teacher that is free at this slot
        const eligForBt = shuffle(teachers).filter((t) => {
          if (btLockedId !== undefined && t.id !== btLockedId) return false;
          if (!canTeachSubject(t, btSubj.id)) return false;
          const ts = teacherStates.get(t.id)!;
          if (effectiveHours(t) <= ts.assignedHours) return false;
          if (!isTeacherAvailableOnDay(t, btDay)) return false;
          if (!isTeacherAvailableAtSlot(t, btSlot)) return false;
          return true;
        });

        for (const btT of eligForBt) {
          if (btPlaced) break;
          const btTs = teacherStates.get(btT.id)!;
          if (!btTs.busySlots.has(btSk)) {
            // Depth-0: teacher free → place directly (should have been caught by repair)
            repairRecord(btCls, btClassState, btSubj, btT, btDay, btSlot, true);
            classSubjectTeacher.set(btCsKey, btT.id);
            assignment.remaining--;
            btPlaced = true;
            break;
          }
          // Depth-1: teacher busy → find their blocking entry and move it
          const d1Idx = entries.findIndex((e) => e.teacher_id === btT.id && e.day === btDay && e.slot === btSlot);
          if (d1Idx < 0) continue;
          const d1Undo = tryMoveEntryBt(d1Idx, btSk);
          if (d1Undo) {
            repairRecord(btCls, btClassState, btSubj, btT, btDay, btSlot, true);
            classSubjectTeacher.set(btCsKey, btT.id);
            assignment.remaining--;
            btPlaced = true;
            break;
          }
          // Depth-2: blocking entry can't move directly.
          // Find what's blocking IT and move that first, then retry.
          const d1Entry = entries[d1Idx];
          const d1Subj = subjects.find((s) => s.id === d1Entry.subject_id);
          if (!d1Subj) continue;
          if (d1Subj.coupled_class_ids.length > 0) continue;
          if (d1Subj.parallel_partner_subject_ids.length > 0) continue;
          const d1T = teachers.find((t) => t.id === d1Entry.teacher_id);
          if (!d1T) continue;
          const d1Ts = teacherStates.get(d1T.id)!;
          const d1AD = getSubjectAllowedDays(d1Subj);
          const d1GMax = maxHoursPerDayByGrade.get(classes.find((c) => c.id === d1Entry.class_id)?.grade_level ?? 1) ?? 6;
          const d1AS = getSubjectAllowedSlots(d1Subj, d1GMax);

          for (const d2Day of shuffle(d1AD)) {
            if (btPlaced) break;
            for (const d2Slot of d1AS) {
              if (btPlaced) break;
              const d2Sk = slotKey(d2Day, d2Slot);
              if (d2Sk === slotKey(d1Entry.day as Weekday, d1Entry.slot)) continue;
              if (d2Sk === btSk) continue;
              if (d1Ts.busySlots.has(d2Sk)) {
                // d1T is also busy at this alternative — find that blocker and move it (depth-2 move)
                const d2Idx = entries.findIndex((e) => e.teacher_id === d1T.id && e.day === d2Day && e.slot === d2Slot);
                if (d2Idx < 0) continue;
                const d2Undo = tryMoveEntryBt(d2Idx, btSk);
                if (!d2Undo) continue;
                // Now d1T is free at d2Sk — try to move d1Entry there
                const d1UndoNow = tryMoveEntryBt(d1Idx, btSk);
                if (d1UndoNow) {
                  repairRecord(btCls, btClassState, btSubj, btT, btDay, btSlot, true);
                  classSubjectTeacher.set(btCsKey, btT.id);
                  assignment.remaining--;
                  btPlaced = true;
                  break;
                } else {
                  d2Undo(); // undo depth-2 move
                }
              }
            }
          }
        }
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
      warnings,
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
