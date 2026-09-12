'use strict';

/*
 * Data-access layer for Exercise and WorkoutSet records. Basic CRUD plus
 * queries that need to reason about relationships between stores (e.g.
 * "what's the most recent set logged for this exercise") live here rather
 * than on the model classes, since Exercise/WorkoutSet themselves stay
 * "dumb" plain data containers.
 */

(function () {

const { db: repoDb, STORES: REPO_STORES } = window.WorkoutDB;
const { Exercise, WorkoutSet, Workout, ExerciseNote, Gym, PersonalRecord, Plan, WorkoutTemplate, GENERAL_GYM_ID } =
  window.WorkoutModels;

const DRAFT_ID = 'current';

// -- Exercise CRUD -----------------------------------------------------

async function createExercise(data) {
  const exercise = new Exercise(data);
  await repoDb.put(REPO_STORES.exercises, exercise.toRecord());
  return exercise;
}

async function getExercise(id) {
  const record = await repoDb.get(REPO_STORES.exercises, id);
  return record ? Exercise.fromRecord(record) : null;
}

async function getAllExercises() {
  const records = await repoDb.getAll(REPO_STORES.exercises);
  return records.map(Exercise.fromRecord);
}

async function updateExercise(exercise) {
  const instance = exercise instanceof Exercise ? exercise : new Exercise(exercise);
  await repoDb.put(REPO_STORES.exercises, instance.toRecord());
  return instance;
}

async function deleteExercise(id) {
  return repoDb.delete(REPO_STORES.exercises, id);
}

// -- WorkoutSet CRUD -----------------------------------------------------

async function createWorkoutSet(data) {
  const set = new WorkoutSet(data);
  await repoDb.put(REPO_STORES.sets, set.toRecord());
  return set;
}

async function getWorkoutSet(setId) {
  const record = await repoDb.get(REPO_STORES.sets, setId);
  return record ? WorkoutSet.fromRecord(record) : null;
}

async function getSetsForWorkout(workoutId) {
  const records = await repoDb.getAllByIndex(REPO_STORES.sets, 'workout_id', workoutId);
  return records.map(WorkoutSet.fromRecord);
}

async function getSetsForExercise(exerciseId) {
  const records = await repoDb.getAllByIndex(REPO_STORES.sets, 'exercise_id', exerciseId);
  return records.map(WorkoutSet.fromRecord);
}

async function updateWorkoutSet(set) {
  const instance = set instanceof WorkoutSet ? set : new WorkoutSet(set);
  await repoDb.put(REPO_STORES.sets, instance.toRecord());
  return instance;
}

async function deleteWorkoutSet(setId) {
  return repoDb.delete(REPO_STORES.sets, setId);
}

/**
 * Returns the WorkoutSet(s) logged the last time this exercise was
 * performed (i.e. every set belonging to the most recent Workout that
 * includes this exercise), ordered warm-up sets first then working sets,
 * each in ascending set_number. Returns [] if the exercise has never been
 * logged. Used later to pre-fill "last time you did this, you did X".
 *
 * `gymId`, when given and not the General gym, restricts this to sets
 * logged at that same gym (e.g. show the previous weight from the Kielce
 * gym specifically). Omitted or General means "any gym" — the original,
 * gym-agnostic behavior.
 */
async function getLastLoggedSetsForExercise(exerciseId, gymId) {
  let sets = await getSetsForExercise(exerciseId);
  if (gymId && gymId !== GENERAL_GYM_ID) {
    sets = sets.filter((s) => (s.gym_id ?? GENERAL_GYM_ID) === gymId);
  }
  if (sets.length === 0) return [];

  const workoutIds = [...new Set(sets.map((s) => s.workout_id))];
  const workouts = await Promise.all(workoutIds.map((id) => repoDb.get(REPO_STORES.workouts, id)));

  const dateByWorkoutId = new Map();
  workouts.forEach((w) => {
    if (w) dateByWorkoutId.set(w.id, w.date);
  });

  let latestDate = null;
  for (const workoutId of workoutIds) {
    const date = dateByWorkoutId.get(workoutId);
    if (date && (latestDate === null || date > latestDate)) latestDate = date;
  }
  if (latestDate === null) return [];

  const latestWorkoutIds = new Set(workoutIds.filter((id) => dateByWorkoutId.get(id) === latestDate));

  return sets
    .filter((s) => latestWorkoutIds.has(s.workout_id))
    .sort((a, b) => {
      if (a.is_warmup_set !== b.is_warmup_set) return a.is_warmup_set ? -1 : 1;
      return (a.set_number ?? 0) - (b.set_number ?? 0);
    });
}

/**
 * Same idea as getLastLoggedSetsForExercise, but excludes one workout from
 * consideration — used when editing a finished workout, so "Previous"
 * compares against the workout before it, not against itself. Also accepts
 * the same optional `gymId` filter (see getLastLoggedSetsForExercise).
 */
async function getPreviousLoggedSetsForExercise(exerciseId, excludeWorkoutId, gymId) {
  const allSets = await getSetsForExercise(exerciseId);
  let sets = excludeWorkoutId ? allSets.filter((s) => s.workout_id !== excludeWorkoutId) : allSets;
  if (gymId && gymId !== GENERAL_GYM_ID) {
    sets = sets.filter((s) => (s.gym_id ?? GENERAL_GYM_ID) === gymId);
  }
  if (sets.length === 0) return [];

  const workoutIds = [...new Set(sets.map((s) => s.workout_id))];
  const workouts = await Promise.all(workoutIds.map((id) => repoDb.get(REPO_STORES.workouts, id)));

  const dateByWorkoutId = new Map();
  workouts.forEach((w) => {
    if (w) dateByWorkoutId.set(w.id, w.date);
  });

  let latestDate = null;
  for (const workoutId of workoutIds) {
    const date = dateByWorkoutId.get(workoutId);
    if (date && (latestDate === null || date > latestDate)) latestDate = date;
  }
  if (latestDate === null) return [];

  const latestWorkoutIds = new Set(workoutIds.filter((id) => dateByWorkoutId.get(id) === latestDate));

  return sets
    .filter((s) => latestWorkoutIds.has(s.workout_id))
    .sort((a, b) => {
      if (a.is_warmup_set !== b.is_warmup_set) return a.is_warmup_set ? -1 : 1;
      return (a.set_number ?? 0) - (b.set_number ?? 0);
    });
}

// -- Gym CRUD -------------------------------------------------------------

async function getAllGyms() {
  const records = await repoDb.getAll(REPO_STORES.gyms);
  return records.map(Gym.fromRecord);
}

async function createGym(data) {
  const gym = new Gym(data);
  await repoDb.put(REPO_STORES.gyms, gym.toRecord());
  return gym;
}

async function updateGym(gym) {
  const instance = gym instanceof Gym ? gym : new Gym(gym);
  await repoDb.put(REPO_STORES.gyms, instance.toRecord());
  return instance;
}

/**
 * Deletes a gym (never the General one, which is a fixed sentinel, not a
 * real deletable record). Any WorkoutSet logged at the deleted gym falls
 * back to General rather than being left pointing at a gym that no longer
 * exists.
 */
async function deleteGym(id) {
  if (id === GENERAL_GYM_ID) return;

  const records = await repoDb.getAll(REPO_STORES.sets);
  for (const record of records) {
    if (record.gym_id === id) {
      await repoDb.put(REPO_STORES.sets, { ...record, gym_id: GENERAL_GYM_ID });
    }
  }

  return repoDb.delete(REPO_STORES.gyms, id);
}

// -- Personal records (hand-marked; every one ever marked is kept) -------

/**
 * Every PR ever marked for this exercise, newest first. `gymId` is a plain
 * literal filter (like Exercise History's gym filter, not the "General
 * ignores gym" convention used elsewhere) — omit it or pass 'all' to see
 * PRs from every gym.
 */
async function getPRHistory(exerciseId, gymId) {
  const all = await repoDb.getAll(REPO_STORES.personalRecords);
  return all
    .filter((r) => r.exercise_id === exerciseId)
    .filter((r) => !gymId || gymId === 'all' || r.gym_id === gymId)
    .map(PersonalRecord.fromRecord)
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

/**
 * The most recently marked PR for this exact exercise+gym pair (used by
 * the in-workout PR dialog's "current best" quick view). `beforeDate`, when
 * given, excludes any PR dated on or after it — so reviewing/editing an old
 * workout from Workout Detail shows the PR that stood *at that time*, never
 * a look-ahead from a PR set later (including one from this same workout).
 */
async function getLatestPR(exerciseId, gymId, beforeDate) {
  const history = await getPRHistory(exerciseId, gymId);
  const eligible = beforeDate ? history.filter((pr) => (pr.date ?? '') < beforeDate) : history;
  return eligible[0] ?? null;
}

/** Appends a new PR entry. Marking a PR never overwrites a previous one —
 * every snapshot is kept permanently so progress can be reviewed later
 * (see getPRHistory). */
async function createPR({ exercise_id, gym_id, date, sets }) {
  const pr = new PersonalRecord({ exercise_id, gym_id, date, sets });
  await repoDb.put(REPO_STORES.personalRecords, pr.toRecord());
  return pr;
}

// -- Stats tab (Muscle Group / Workout / Exercise Rankings / PR Stats) ---
//
// Every function here is a pure read, recomputed live from the existing
// stores — nothing here is ever persisted. `startDate`/`endDate` are
// inclusive ISO yyyy-mm-dd strings; pass `null` for either to leave that
// side of the range open (used for "All Time" once the earliest workout
// date has been resolved by the caller).

/** Finished workouts whose date falls within [startDate, endDate]. */
async function getWorkoutsInRange(startDate, endDate) {
  const all = await getAllWorkouts();
  return all.filter((w) => (!startDate || w.date >= startDate) && (!endDate || w.date <= endDate));
}

/** The earliest date any finished workout was logged on, or null if there
 * are none yet — used to resolve the "All Time" range's start date. */
async function getEarliestWorkoutDate() {
  const all = await getAllWorkouts();
  if (all.length === 0) return null;
  return all.reduce((min, w) => (w.date < min ? w.date : min), all[0].date);
}

/**
 * Everything the Stats tab needs for one date range in a single pass:
 * the workouts in range, and every set belonging to one of them. Muscle
 * group / exercise ranking aggregation is done by the caller (stats.js)
 * from this raw joined data, the same "fetch once, aggregate client-side"
 * pattern Exercise History already uses for its gym filter.
 */
async function getRangeStatsData(startDate, endDate) {
  const workouts = await getWorkoutsInRange(startDate, endDate);
  const workoutIds = new Set(workouts.map((w) => w.id));
  const allSetRecords = await repoDb.getAll(REPO_STORES.sets);
  const sets = allSetRecords.filter((s) => workoutIds.has(s.workout_id)).map(WorkoutSet.fromRecord);
  return { workouts, sets };
}

/**
 * All-time weekly training streaks — deliberately NOT scoped by the Stats
 * tab's date-range selector (a "This Week" range can't sensibly show a
 * streak), always computed from full workout history. A week is "trained"
 * if it contains >=1 finished workout; weeks are identified by their
 * Monday's date. `current` counts consecutive trained weeks ending at the
 * most recent trained week — if the current calendar week has no workout
 * yet, that's not treated as breaking the streak (the week isn't over),
 * so counting starts from the last fully-elapsed week instead.
 */
async function getWeeklyStreaks() {
  const all = await getAllWorkouts();
  if (all.length === 0) return { current: 0, longest: 0 };

  const mondayOf = (dateStr) => {
    const d = new Date(`${dateStr}T00:00:00`);
    const day = d.getDay(); // 0 = Sun .. 6 = Sat
    const diffToMonday = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diffToMonday);
    return d;
  };
  const toKey = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const addDays = (d, n) => {
    const copy = new Date(d);
    copy.setDate(copy.getDate() + n);
    return copy;
  };

  const trainedWeeks = new Set(all.map((w) => toKey(mondayOf(w.date))));
  const sortedWeeks = [...trainedWeeks].sort();

  let longest = 0;
  let run = 0;
  let prev = null;
  for (const wk of sortedWeeks) {
    if (prev !== null && (new Date(wk) - new Date(prev)) / 86400000 === 7) run += 1;
    else run = 1;
    longest = Math.max(longest, run);
    prev = wk;
  }

  const thisWeekStart = toKey(mondayOf(toKey(new Date())));
  let current = 0;
  let cursor = trainedWeeks.has(thisWeekStart) ? thisWeekStart : toKey(addDays(new Date(thisWeekStart), -7));
  while (trainedWeeks.has(cursor)) {
    current += 1;
    cursor = toKey(addDays(new Date(cursor), -7));
  }

  return { current, longest };
}

/**
 * Every logged set for this exercise across all workouts and gyms, grouped
 * by workout and sorted newest workout first. Gym filtering (a plain literal
 * filter, unlike the "General ignores gym" convention used by
 * getLastLoggedSetsForExercise/getPreviousLoggedSetsForExercise above) is
 * deliberately left to the caller — the Exercise History view filters this
 * unfiltered list client-side so switching the gym filter doesn't need a
 * fresh query. Returns [] if the exercise has never been logged.
 */
async function getExerciseHistory(exerciseId) {
  const sets = await getSetsForExercise(exerciseId);
  if (sets.length === 0) return [];

  const workoutIds = [...new Set(sets.map((s) => s.workout_id))];
  const workouts = await Promise.all(workoutIds.map((id) => repoDb.get(REPO_STORES.workouts, id)));
  const workoutById = new Map();
  workouts.forEach((w) => {
    if (w) workoutById.set(w.id, w);
  });

  const groups = new Map(); // workout_id -> { workoutId, date, sets: [] }
  sets.forEach((s) => {
    const workout = workoutById.get(s.workout_id);
    if (!workout) return; // guard against a set whose workout no longer exists
    if (!groups.has(s.workout_id)) groups.set(s.workout_id, { workoutId: workout.id, date: workout.date, sets: [] });
    groups.get(s.workout_id).sets.push(s);
  });

  groups.forEach((group) => {
    group.sets.sort((a, b) => {
      if (a.is_warmup_set !== b.is_warmup_set) return a.is_warmup_set ? -1 : 1;
      return (a.set_number ?? 0) - (b.set_number ?? 0);
    });
  });

  return [...groups.values()].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

// -- Workout CRUD (finished workouts only) -------------------------------

async function createWorkout(data) {
  const workout = new Workout(data);
  await repoDb.put(REPO_STORES.workouts, workout.toRecord());
  return workout;
}

async function getWorkout(id) {
  const record = await repoDb.get(REPO_STORES.workouts, id);
  return record ? Workout.fromRecord(record) : null;
}

async function getAllWorkouts() {
  const records = await repoDb.getAll(REPO_STORES.workouts);
  return records.map(Workout.fromRecord);
}

async function updateWorkout(workout) {
  const instance = workout instanceof Workout ? workout : new Workout(workout);
  await repoDb.put(REPO_STORES.workouts, instance.toRecord());
  return instance;
}

/** Deletes a finished workout and cascades to its sets and exercise notes. */
async function deleteWorkout(workoutId) {
  const sets = await getSetsForWorkout(workoutId);
  for (const s of sets) await deleteWorkoutSet(s.set_id);

  const notes = await getExerciseNotesForWorkout(workoutId);
  for (const n of notes) await repoDb.delete(REPO_STORES.exerciseNotes, n.id);

  await repoDb.delete(REPO_STORES.workouts, workoutId);
}

// -- ExerciseNote CRUD ---------------------------------------------------

async function createExerciseNote(data) {
  const note = new ExerciseNote(data);
  await repoDb.put(REPO_STORES.exerciseNotes, note.toRecord());
  return note;
}

async function getExerciseNotesForExercise(exerciseId) {
  const records = await repoDb.getAllByIndex(REPO_STORES.exerciseNotes, 'exercise_id', exerciseId);
  return records.map(ExerciseNote.fromRecord);
}

async function getExerciseNotesForWorkout(workoutId) {
  const records = await repoDb.getAllByIndex(REPO_STORES.exerciseNotes, 'workout_id', workoutId);
  return records.map(ExerciseNote.fromRecord);
}

/**
 * Creates, updates, or deletes the (at most one) ExerciseNote for a given
 * exercise+workout pair, keeping the "one note per exercise per workout"
 * rule intact when editing a finished workout after the fact. Passing
 * empty/blank text deletes the note if one exists. Returns the resulting
 * note, or null if it was deleted/never existed.
 */
async function upsertExerciseNoteForWorkout(exerciseId, workoutId, text) {
  const notes = await getExerciseNotesForWorkout(workoutId);
  const existing = notes.find((n) => n.exercise_id === exerciseId);

  if (!text || !text.trim()) {
    if (existing) await repoDb.delete(REPO_STORES.exerciseNotes, existing.id);
    return null;
  }

  if (existing) {
    existing.text = text;
    await repoDb.put(REPO_STORES.exerciseNotes, existing.toRecord());
    return existing;
  }

  return createExerciseNote({ exercise_id: exerciseId, workout_id: workoutId, text });
}

/**
 * The note to show when starting to log this exercise: the text of the
 * most recent ExerciseNote for it, most recent meaning the associated
 * workout's date. Returns null if the exercise has no notes yet.
 */
async function getMostRecentExerciseNoteForExercise(exerciseId) {
  const notes = await getExerciseNotesForExercise(exerciseId);
  if (notes.length === 0) return null;

  const workoutIds = [...new Set(notes.map((n) => n.workout_id))];
  const workouts = await Promise.all(workoutIds.map((id) => repoDb.get(REPO_STORES.workouts, id)));
  const dateByWorkoutId = new Map();
  workouts.forEach((w) => {
    if (w) dateByWorkoutId.set(w.id, w.date);
  });

  let best = null;
  let bestDate = null;
  for (const note of notes) {
    const date = dateByWorkoutId.get(note.workout_id);
    if (!date) continue;
    if (bestDate === null || date > bestDate) {
      bestDate = date;
      best = note;
    }
  }
  return best;
}

// -- Draft workout (temporary, single-draft, persists across reloads) ----
//
// The draft is a plain object, not one of the permanent model classes — it
// holds in-progress data (unticked sets, unsaved notes, a start time) that
// only becomes real Workout/WorkoutSet/ExerciseNote records once the user
// finishes the workout (see finishDraftWorkout below). Stored under a
// fixed id so there is always at most one.

async function getDraft() {
  const record = await repoDb.get(REPO_STORES.draftWorkout, DRAFT_ID);
  return record ?? null;
}

async function saveDraft(draft) {
  const record = { ...draft, id: DRAFT_ID };
  await repoDb.put(REPO_STORES.draftWorkout, record);
  return record;
}

async function deleteDraft() {
  return repoDb.delete(REPO_STORES.draftWorkout, DRAFT_ID);
}

/**
 * Converts a draft into permanent records: a Workout, one WorkoutSet per
 * completed draft set (incomplete ones are dropped), and one ExerciseNote
 * per exercise that has draft note text. Deletes the draft afterward.
 * Returns the created Workout.
 */
async function finishDraftWorkout(draft) {
  const workout = await createWorkout({ name: draft.name, date: draft.date, exerciseOrder: draft.exercises });

  const completedSets = (draft.sets ?? []).filter((s) => s.done);
  for (const s of completedSets) {
    await createWorkoutSet({
      exercise_id: s.exercise_id,
      workout_id: workout.id,
      set_number: s.set_number,
      is_warmup_set: s.is_warmup_set,
      input_1: s.input_1,
      input_1_right: s.input_1_right,
      input_2: s.input_2,
      rir: s.rir,
      rpe: s.rpe,
      notes: s.notes,
      gym_id: s.gym_id ?? GENERAL_GYM_ID,
    });
  }

  const exerciseNotes = draft.exerciseNotes ?? {};
  for (const [exerciseId, text] of Object.entries(exerciseNotes)) {
    if (!text || !text.trim()) continue;
    await createExerciseNote({ exercise_id: exerciseId, workout_id: workout.id, text });
  }

  await deleteDraft();
  return workout;
}

// -- Plan / WorkoutTemplate CRUD -----------------------------------------

async function createPlan(data) {
  const plan = new Plan(data);
  await repoDb.put(REPO_STORES.plans, plan.toRecord());
  return plan;
}

async function getPlan(id) {
  const record = await repoDb.get(REPO_STORES.plans, id);
  return record ? Plan.fromRecord(record) : null;
}

async function getAllPlans() {
  const records = await repoDb.getAll(REPO_STORES.plans);
  return records.map(Plan.fromRecord);
}

async function updatePlan(plan) {
  const instance = plan instanceof Plan ? plan : new Plan(plan);
  await repoDb.put(REPO_STORES.plans, instance.toRecord());
  return instance;
}

/** Deletes a Plan and cascades to every WorkoutTemplate that belongs to it —
 * same "delete the container, delete its children" convention as
 * deleteWorkout cascading to its sets/notes. */
async function deletePlan(id) {
  const templates = await getWorkoutTemplatesForPlan(id);
  for (const template of templates) await repoDb.delete(REPO_STORES.workoutTemplates, template.id);
  await repoDb.delete(REPO_STORES.plans, id);
}

async function createWorkoutTemplate(data) {
  const template = new WorkoutTemplate(data);
  await repoDb.put(REPO_STORES.workoutTemplates, template.toRecord());
  return template;
}

async function getWorkoutTemplate(id) {
  const record = await repoDb.get(REPO_STORES.workoutTemplates, id);
  return record ? WorkoutTemplate.fromRecord(record) : null;
}

async function getWorkoutTemplatesForPlan(planId) {
  const records = await repoDb.getAllByIndex(REPO_STORES.workoutTemplates, 'plan_id', planId);
  return records.map(WorkoutTemplate.fromRecord);
}

async function updateWorkoutTemplate(template) {
  const instance = template instanceof WorkoutTemplate ? template : new WorkoutTemplate(template);
  await repoDb.put(REPO_STORES.workoutTemplates, instance.toRecord());
  return instance;
}

async function deleteWorkoutTemplate(id) {
  return repoDb.delete(REPO_STORES.workoutTemplates, id);
}

/**
 * Manual smoke test for the data layer, runnable from the browser console:
 *   await WorkoutRepo.debugSelfTest()
 * Creates a throwaway exercise/workout/sets, exercises the CRUD + query
 * functions, logs the results, then cleans up after itself.
 */
async function debugSelfTest() {
  const results = {};

  const exercise = await createExercise({
    name: '[debug] Bench Press',
    muscleGroups: ['chest', 'tricep'],
    metric: { type: window.WorkoutModels.MetricType.REPS, unit: window.WorkoutModels.Unit.KG },
    effortTracking: window.WorkoutModels.EffortTracking.RIR,
  });
  results.createExercise = exercise;

  results.getExercise = await getExercise(exercise.id);

  exercise.notes = 'debug note';
  results.updateExercise = await updateExercise(exercise);

  const workout = await createWorkout({ name: '[debug] Workout', date: new Date().toISOString().slice(0, 10) });

  const setA = await createWorkoutSet({
    exercise_id: exercise.id,
    workout_id: workout.id,
    set_number: 1,
    is_warmup_set: true,
    input_1: 10,
    input_2: 20,
  });
  const setB = await createWorkoutSet({
    exercise_id: exercise.id,
    workout_id: workout.id,
    set_number: 1,
    is_warmup_set: false,
    input_1: 8,
    input_2: 60,
    rir: 2,
    notes: 'debug set note',
  });
  results.createWorkoutSets = [setA, setB];

  results.getSetsForExercise = await getSetsForExercise(exercise.id);
  results.getLastLoggedSetsForExercise = await getLastLoggedSetsForExercise(exercise.id);

  await deleteWorkoutSet(setA.set_id);
  await deleteWorkoutSet(setB.set_id);
  await repoDb.delete(REPO_STORES.workouts, workout.id);
  await deleteExercise(exercise.id);
  results.cleanedUp = true;

  console.log('WorkoutRepo.debugSelfTest results:', results);
  return results;
}

window.WorkoutRepo = {
  createExercise,
  getExercise,
  getAllExercises,
  updateExercise,
  deleteExercise,
  createWorkoutSet,
  getWorkoutSet,
  getSetsForWorkout,
  getSetsForExercise,
  updateWorkoutSet,
  deleteWorkoutSet,
  getLastLoggedSetsForExercise,
  getPreviousLoggedSetsForExercise,
  getExerciseHistory,
  createWorkout,
  getWorkout,
  getAllWorkouts,
  updateWorkout,
  deleteWorkout,
  createExerciseNote,
  getExerciseNotesForExercise,
  getExerciseNotesForWorkout,
  upsertExerciseNoteForWorkout,
  getMostRecentExerciseNoteForExercise,
  getDraft,
  saveDraft,
  deleteDraft,
  finishDraftWorkout,
  getAllGyms,
  createGym,
  updateGym,
  deleteGym,
  getPRHistory,
  getLatestPR,
  createPR,
  getWorkoutsInRange,
  getEarliestWorkoutDate,
  getRangeStatsData,
  getWeeklyStreaks,
  createPlan,
  getPlan,
  getAllPlans,
  updatePlan,
  deletePlan,
  createWorkoutTemplate,
  getWorkoutTemplate,
  getWorkoutTemplatesForPlan,
  updateWorkoutTemplate,
  deleteWorkoutTemplate,
  debugSelfTest,
};

})();
