'use strict';

/*
 * Core data model classes. Fields marked "stable" are foundational and must
 * never be restructured; future segments should only add new optional
 * fields (read with `?? default`) on top of these.
 */

(function () {

const SCHEMA_VERSION = window.WorkoutDB.CURRENT_SCHEMA_VERSION;

/**
 * The two dropdowns used when defining a metric on an Exercise. Every unit
 * is selectable for every type — there is deliberately no pairing/filtering
 * logic between them; the user picks any combination freely. Each value has
 * an implied input format (see workout.js's INPUT_FORMAT_BY_TYPE/BY_UNIT)
 * used to auto-format what the user types on the workout screen.
 */
const MetricType = {
  REPS: 'reps',
  REPS_PER_SIDE: 'reps_per_side',
  SECONDS: 'seconds',
  MIN_SEC: 'min_sec',
  HR_MIN: 'hr_min',
  METERS: 'meters',
};

const Unit = {
  NONE: 'none',
  KG: 'kg',
  KG_PER_SIDE: 'kg_per_side',
  LBS: 'lbs',
  LBS_PER_SIDE: 'lbs_per_side',
  CENTIMETERS: 'centimeters',
  METERS: 'meters',
  KM: 'km',
  MILES: 'miles',
  WATTS: 'watts',
  RESISTANCE_LEVEL: 'resistance_level',
};

/**
 * Fixed, predefined muscle group vocabulary (not free text, not
 * user-editable). A single ordered array so adding a future entry (one more
 * is pending) is a one-line change instead of touching multiple lists.
 */
const MUSCLE_GROUPS = [
  'none',
  'neck',
  'chest',
  'upper_chest',
  'shoulders',
  'lower_back',
  'lats',
  'traps',
  'teres',
  'bicep',
  'tricep',
  'forearm',
  'abs_core',
  'quads',
  'hamstring',
  'glutes',
  'abductor',
  'adductor',
  'calves',
  'cardio',
];

/** Exclusive effort-tracking mode for an Exercise: never both RIR and RPE. */
const EffortTracking = {
  NONE: 'none',
  RIR: 'rir',
  RPE: 'rpe',
};

/**
 * Fixed id of the always-present "General" gym. Not a physical location —
 * it's the "ignore gym" filter: sets logged under it (or looked up while it
 * is selected) match regardless of which gym they were actually logged at.
 * Every custom Gym the user adds is a real location filter by contrast.
 */
const GENERAL_GYM_ID = 'general';

/**
 * A gym/location the user can log workouts at. Exercises don't reference
 * gyms directly — WorkoutSet.gym_id does, since the same exercise can be
 * logged at different gyms across (or even within) workouts.
 */
class Gym {
  constructor({ id, name, schemaVersion } = {}) {
    this.id = id ?? window.WorkoutDB.generateId();
    this.name = name ?? ''; // stable, user-entered (ignored for the General gym, which is always shown localized)
    this.schemaVersion = schemaVersion ?? SCHEMA_VERSION;
  }

  static fromRecord(record) {
    const r = window.WorkoutDB.migrateRecord(record);
    return new Gym({ id: r.id, name: r.name ?? '', schemaVersion: r.schemaVersion });
  }

  toRecord() {
    return { ...this };
  }
}

/**
 * Definition of an exercise the user has created. Does not store historical
 * logged data or "last used" stats — that's derived/queried from the sets
 * store (see repository.js's getLastLoggedSetsForExercise).
 */
const DEFAULT_METRIC = { type: MetricType.REPS, unit: Unit.NONE };

class Exercise {
  constructor({
    id,
    name,
    muscleGroups = [],
    metric = null,
    effortTracking = EffortTracking.NONE,
    notes = '',
    schemaVersion,
  } = {}) {
    this.id = id ?? window.WorkoutDB.generateId();
    this.name = name; // stable, user-entered
    this.muscleGroups = Array.isArray(muscleGroups) ? [...muscleGroups] : []; // stable, multi-select from MUSCLE_GROUPS
    // { type: MetricType, unit: Unit }. Input 1 on the workout screen is the
    // value for `type`; Input 2 (shown only when unit isn't 'none') is the
    // value in `unit`, e.g. type: reps, unit: kg -> "8 reps @ 60 kg".
    this.metric = metric && metric.type ? { type: metric.type, unit: metric.unit ?? Unit.NONE } : { ...DEFAULT_METRIC };
    this.effortTracking = effortTracking ?? EffortTracking.NONE; // 'none' | 'rir' | 'rpe', mutually exclusive
    this.notes = notes ?? '';
    this.schemaVersion = schemaVersion ?? SCHEMA_VERSION;
  }

  static fromRecord(record) {
    const r = window.WorkoutDB.migrateRecord(record);
    // Safe defaults for records saved before muscleGroups/effortTracking
    // existed (single muscleGroup string, separate tracksRIR/tracksRPE bools),
    // and before the metrics array collapsed to a single `metric` (older
    // records take metrics[0] and drop any second metric definition).
    const muscleGroups = r.muscleGroups ?? (r.muscleGroup ? [r.muscleGroup] : []);
    let effortTracking = r.effortTracking;
    if (effortTracking == null) {
      if (r.tracksRIR) effortTracking = EffortTracking.RIR;
      else if (r.tracksRPE) effortTracking = EffortTracking.RPE;
      else effortTracking = EffortTracking.NONE;
    }
    const metric = r.metric ?? (Array.isArray(r.metrics) ? r.metrics[0] : null) ?? DEFAULT_METRIC;
    return new Exercise({
      id: r.id,
      name: r.name,
      muscleGroups,
      metric,
      effortTracking,
      notes: r.notes ?? '',
      schemaVersion: r.schemaVersion,
    });
  }

  toRecord() {
    return { ...this, metric: { ...this.metric }, muscleGroups: [...this.muscleGroups] };
  }
}

/**
 * A single logged set. Deliberately "dumb": it doesn't know what input_1 /
 * input_2 mean semantically — that comes from looking up the associated
 * Exercise's `metric` (input_1 = the metric's type value, input_2 = the
 * metric's unit value when its unit isn't 'none'). No rest time, timestamp,
 * notes, or completed/skipped flag by design.
 */
class WorkoutSet {
  constructor({
    set_id,
    exercise_id,
    workout_id,
    set_number,
    is_warmup_set = false,
    input_1 = null,
    input_1_right = null,
    input_2 = null,
    rir = null,
    rpe = null,
    notes = '',
    gym_id = GENERAL_GYM_ID,
    schemaVersion,
  } = {}) {
    this.set_id = set_id ?? window.WorkoutDB.generateId();
    this.exercise_id = exercise_id; // stable, references Exercise.id
    this.workout_id = workout_id; // stable, references Workout.id
    this.set_number = set_number; // stable, warm-up and working sets number separately (see is_warmup_set)
    this.is_warmup_set = is_warmup_set ?? false;
    this.input_1 = input_1 ?? null; // value for the exercise's first metric definition; the Left side's value when metric.type is 'reps_per_side'
    this.input_1_right = input_1_right ?? null; // the Right side's value, only meaningful when metric.type is 'reps_per_side'
    this.input_2 = input_2 ?? null; // value for the second metric definition, if any
    this.rir = rir ?? null; // only meaningful when Exercise.effortTracking is 'rir'
    this.rpe = rpe ?? null; // only meaningful when Exercise.effortTracking is 'rpe'
    this.notes = notes ?? '';
    this.gym_id = gym_id ?? GENERAL_GYM_ID; // references Gym.id; which gym this set was logged at
    this.schemaVersion = schemaVersion ?? SCHEMA_VERSION;
  }

  static fromRecord(record) {
    const r = window.WorkoutDB.migrateRecord(record);
    return new WorkoutSet({
      set_id: r.set_id,
      exercise_id: r.exercise_id,
      workout_id: r.workout_id,
      set_number: r.set_number ?? null,
      is_warmup_set: r.is_warmup_set ?? false,
      input_1: r.input_1 ?? null,
      input_1_right: r.input_1_right ?? null,
      input_2: r.input_2 ?? null,
      rir: r.rir ?? null,
      rpe: r.rpe ?? null,
      notes: r.notes ?? '',
      gym_id: r.gym_id ?? GENERAL_GYM_ID,
      schemaVersion: r.schemaVersion,
    });
  }

  toRecord() {
    return { ...this };
  }
}

/**
 * A finished workout. Only created once the user finishes a workout (see
 * the draft system in workout.js) — a Workout record's mere existence
 * means it's done. No in-progress state, no start/end time (that lives
 * only in the draft; a finished Workout has just a date, not a time).
 */
class Workout {
  constructor({ id, name, date, exerciseOrder = [], schemaVersion } = {}) {
    this.id = id ?? window.WorkoutDB.generateId();
    this.name = name ?? ''; // stable
    this.date = date; // stable, ISO yyyy-mm-dd, no time component
    this.exerciseOrder = Array.isArray(exerciseOrder) ? [...exerciseOrder] : []; // exercise_id[], left-to-right display order
    this.schemaVersion = schemaVersion ?? SCHEMA_VERSION;
  }

  static fromRecord(record) {
    const r = window.WorkoutDB.migrateRecord(record);
    return new Workout({
      id: r.id,
      name: r.name ?? '',
      date: r.date,
      exerciseOrder: r.exerciseOrder ?? [],
      schemaVersion: r.schemaVersion,
    });
  }

  toRecord() {
    return { ...this, exerciseOrder: [...this.exerciseOrder] };
  }
}

/**
 * A hand-marked personal record for one exercise at one gym: a snapshot of
 * every set (warm-up and working, all metrics/effort values) from whatever
 * workout the user tapped "Mark as PR" in. Never computed automatically —
 * the user decides when their current numbers beat the old ones. Every PR
 * ever marked is kept permanently (an append-only history, not an upsert) so
 * progress over time can be reviewed later — see WorkoutRepo.getPRHistory.
 */
class PersonalRecord {
  constructor({ id, exercise_id, gym_id, date, sets = [], schemaVersion } = {}) {
    this.id = id ?? window.WorkoutDB.generateId();
    this.exercise_id = exercise_id; // stable, references Exercise.id
    this.gym_id = gym_id; // stable, references Gym.id (or GENERAL_GYM_ID)
    this.date = date ?? null; // when this PR was marked
    this.sets = Array.isArray(sets) ? sets.map((s) => ({ ...s })) : []; // plain snapshots: { set_number, is_warmup_set, input_1, input_2, rir, rpe }
    this.schemaVersion = schemaVersion ?? SCHEMA_VERSION;
  }

  static fromRecord(record) {
    const r = window.WorkoutDB.migrateRecord(record);
    return new PersonalRecord({
      id: r.id,
      exercise_id: r.exercise_id,
      gym_id: r.gym_id,
      date: r.date ?? null,
      sets: r.sets ?? [],
      schemaVersion: r.schemaVersion,
    });
  }

  toRecord() {
    return { ...this, sets: this.sets.map((s) => ({ ...s })) };
  }
}

/**
 * A carry-forward note written about an exercise during a specific
 * (finished) workout. Full history is kept — every note ever written is
 * its own permanent record, never overwritten. At most one per
 * exercise per workout (enforced by the draft/finish flow, not here).
 * Distinct from Exercise.notes (a single, permanent, general note about
 * the exercise itself, unrelated to any specific workout).
 */
class ExerciseNote {
  constructor({ id, exercise_id, workout_id, text, schemaVersion } = {}) {
    this.id = id ?? window.WorkoutDB.generateId();
    this.exercise_id = exercise_id; // stable, references Exercise.id
    this.workout_id = workout_id; // stable, references Workout.id
    this.text = text ?? ''; // stable
    this.schemaVersion = schemaVersion ?? SCHEMA_VERSION;
  }

  static fromRecord(record) {
    const r = window.WorkoutDB.migrateRecord(record);
    return new ExerciseNote({
      id: r.id,
      exercise_id: r.exercise_id,
      workout_id: r.workout_id,
      text: r.text ?? '',
      schemaVersion: r.schemaVersion,
    });
  }

  toRecord() {
    return { ...this };
  }
}

class BodyweightEntry {
  constructor({ id, date, weight, schemaVersion } = {}) {
    this.id = id ?? window.WorkoutDB.generateId();
    this.date = date; // stable, ISO yyyy-mm-dd
    this.weight = weight; // stable
    this.schemaVersion = schemaVersion ?? SCHEMA_VERSION;
  }

  static fromRecord(record) {
    const r = window.WorkoutDB.migrateRecord(record);
    return new BodyweightEntry({
      id: r.id,
      date: r.date,
      weight: r.weight ?? null,
      schemaVersion: r.schemaVersion,
    });
  }

  toRecord() {
    return { ...this };
  }
}

/**
 * A named container of reusable workout structures (see WorkoutTemplate).
 * Editing/deleting a Plan never retroactively touches any already-finished
 * Workout/WorkoutSet or already-created draft — it only affects future
 * workouts started from it, per explicit product decision.
 */
class Plan {
  constructor({ id, name, workoutTemplateOrder = [], schemaVersion } = {}) {
    this.id = id ?? window.WorkoutDB.generateId();
    this.name = name ?? ''; // stable, user-entered
    this.workoutTemplateOrder = Array.isArray(workoutTemplateOrder) ? [...workoutTemplateOrder] : []; // WorkoutTemplate.id[], display order
    this.schemaVersion = schemaVersion ?? SCHEMA_VERSION;
  }

  static fromRecord(record) {
    const r = window.WorkoutDB.migrateRecord(record);
    return new Plan({
      id: r.id,
      name: r.name ?? '',
      workoutTemplateOrder: r.workoutTemplateOrder ?? [],
      schemaVersion: r.schemaVersion,
    });
  }

  toRecord() {
    return { ...this, workoutTemplateOrder: [...this.workoutTemplateOrder] };
  }
}

/**
 * One reusable workout structure within a Plan — exercises, set counts, and
 * per-set RIR/RPE *targets* only. Deliberately no metric values (target
 * reps/weight/time) — templates aren't history, only structure. Never
 * becomes a Workout/WorkoutSet by itself; only used to populate a new draft
 * when the user starts a workout from it (see WorkoutRepo/plans.js).
 */
class WorkoutTemplate {
  constructor({ id, plan_id, name, exercises = [], schemaVersion } = {}) {
    this.id = id ?? window.WorkoutDB.generateId();
    this.plan_id = plan_id; // stable, references Plan.id
    this.name = name ?? ''; // stable, user-entered
    // Each entry: { exercise_id, warmupSetCount, workingSetCount, workingSetTargets }.
    // workingSetTargets is an array of length workingSetCount, one RIR/RPE
    // target per working set — only meaningful when the referenced
    // exercise's effortTracking isn't 'none'; empty/unused otherwise.
    // Warm-up sets never get a target regardless of effortTracking.
    this.exercises = Array.isArray(exercises)
      ? exercises.map((e) => ({
          exercise_id: e.exercise_id,
          warmupSetCount: e.warmupSetCount ?? 0,
          workingSetCount: e.workingSetCount ?? 0,
          workingSetTargets: Array.isArray(e.workingSetTargets) ? [...e.workingSetTargets] : [],
        }))
      : [];
    this.schemaVersion = schemaVersion ?? SCHEMA_VERSION;
  }

  static fromRecord(record) {
    const r = window.WorkoutDB.migrateRecord(record);
    return new WorkoutTemplate({
      id: r.id,
      plan_id: r.plan_id,
      name: r.name ?? '',
      exercises: r.exercises ?? [],
      schemaVersion: r.schemaVersion,
    });
  }

  toRecord() {
    return { ...this, exercises: this.exercises.map((e) => ({ ...e, workingSetTargets: [...e.workingSetTargets] })) };
  }
}

window.WorkoutModels = {
  Exercise,
  WorkoutSet,
  Workout,
  ExerciseNote,
  BodyweightEntry,
  Gym,
  PersonalRecord,
  Plan,
  WorkoutTemplate,
  MetricType,
  Unit,
  MUSCLE_GROUPS,
  EffortTracking,
  GENERAL_GYM_ID,
};

})();
