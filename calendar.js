'use strict';

/*
 * Home tab: tapping a day with a workout dot opens a 3-option choice popup
 * (View Workout / Start the Same Workout / Add to Plan) instead of going
 * straight to Workout Detail. "View Workout" reuses the existing
 * WorkoutHistoryFeature unchanged; the other two derive a workout's
 * exercise/set-count structure from its actual logged WorkoutSets and
 * either spin up a new blank-fields draft or convert it into a new
 * WorkoutTemplate in an existing Plan.
 */

(function () {

const { GENERAL_GYM_ID } = window.WorkoutModels;

function getLang() {
  return window.WorkoutI18nState ? window.WorkoutI18nState.get() : window.I18n.DEFAULT_LANGUAGE;
}

function t(key, params) {
  return window.I18n.t(key, getLang(), params);
}

function todayDateKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * This workout's exercises in display order (Workout.exerciseOrder,
 * falling back to alphabetical for anything not in it — same convention
 * Workout Detail already uses for older pre-exerciseOrder workouts) paired
 * with the warm-up/working set counts it actually had logged. Exercises
 * deleted since are simply absent from the result (silently skipped).
 */
async function deriveStructureFromWorkout(workout) {
  const sets = await window.WorkoutRepo.getSetsForWorkout(workout.id);
  const exerciseIds = [...new Set(sets.map((s) => s.exercise_id))];
  const exercises = await Promise.all(exerciseIds.map((id) => window.WorkoutRepo.getExercise(id)));
  const exerciseById = new Map(exerciseIds.map((id, i) => [id, exercises[i]]));

  const storedOrder = Array.isArray(workout.exerciseOrder) ? workout.exerciseOrder : [];
  const idSet = new Set(exerciseIds);
  const ordered = storedOrder.filter((id) => idSet.has(id));
  const remaining = exerciseIds
    .filter((id) => !ordered.includes(id))
    .sort((a, b) => (exerciseById.get(a)?.name ?? '').localeCompare(exerciseById.get(b)?.name ?? ''));
  const orderedIds = [...ordered, ...remaining];

  const structure = [];
  for (const exerciseId of orderedIds) {
    if (!exerciseById.get(exerciseId)) continue; // deleted since this workout was logged
    const exerciseSets = sets.filter((s) => s.exercise_id === exerciseId);
    structure.push({
      exercise_id: exerciseId,
      warmupSetCount: exerciseSets.filter((s) => s.is_warmup_set).length,
      workingSetCount: exerciseSets.filter((s) => !s.is_warmup_set).length,
    });
  }
  return structure;
}

function draftSet(exerciseId, setNumber, isWarmup, autoFill) {
  return {
    draft_set_id: window.WorkoutDB.generateId(),
    exercise_id: exerciseId,
    set_number: setNumber,
    is_warmup_set: isWarmup,
    input_1: autoFill.input_1,
    input_1_right: autoFill.input_1_right,
    input_2: autoFill.input_2,
    rir: null,
    rpe: null,
    notes: '',
    done: false,
    gym_id: GENERAL_GYM_ID,
  };
}

/**
 * "Start the Same Workout": a new draft with the same exercises/set
 * structure as `workout` actually had. input_1/input_1_right/input_2 are
 * auto-filled the same way the live "Add Set" button and Plans' "start
 * from template" flow both do (WorkoutAutoFill.computeAutoFillValues) —
 * matched by exercise + set number + warmup/working status against
 * whatever was most recently logged, General/"any gym" scope since there's
 * no gym context yet at start time. rir/rpe stay blank — unlike a Plan
 * template, there's no target value to seed them with here. Reuses the
 * same one-active-draft conflict popup as Plans.
 */
async function startSameWorkout(workout) {
  const existingDraft = await window.WorkoutRepo.getDraft();
  if (existingDraft) {
    await window.WorkoutPlans.showActiveDraftConflict();
    return;
  }

  const structure = await deriveStructureFromWorkout(workout);
  const exercises = [];
  const sets = [];

  for (const entry of structure) {
    exercises.push(entry.exercise_id);
    const exercise = await window.WorkoutRepo.getExercise(entry.exercise_id);
    const previousSets = await window.WorkoutRepo.getLastLoggedSetsForExercise(entry.exercise_id, GENERAL_GYM_ID);

    for (let i = 0; i < entry.warmupSetCount; i += 1) {
      const setNumber = i + 1;
      const autoFill = window.WorkoutAutoFill.computeAutoFillValues(exercise, previousSets, setNumber, true);
      sets.push(draftSet(entry.exercise_id, setNumber, true, autoFill));
    }
    for (let i = 0; i < entry.workingSetCount; i += 1) {
      const setNumber = i + 1;
      const autoFill = window.WorkoutAutoFill.computeAutoFillValues(exercise, previousSets, setNumber, false);
      sets.push(draftSet(entry.exercise_id, setNumber, false, autoFill));
    }
  }

  const draft = {
    // Repeating a workout keeps its name, so it's already filled in when
    // the Finish dialog asks for one.
    name: workout.name || t('workout.defaultName'),
    date: todayDateKey(),
    startedAt: new Date().toISOString(),
    exercises,
    activeExerciseId: exercises[0] ?? null,
    sets,
    exerciseNotes: {},
    gymByExercise: {},
    countdown: { remainingSeconds: 0, running: false, targetEndAt: null },
  };

  await window.WorkoutRepo.saveDraft(draft);
  await window.WorkoutActiveFeature.openExisting();
}

// -- Plan picker (for "Add to Plan") ---------------------------------------

function showPlanPicker(plans) {
  const backdrop = document.getElementById('plan-picker-dialog');
  const listEl = document.getElementById('plan-picker-list');
  const emptyEl = document.getElementById('plan-picker-empty');
  const cancelBtn = document.getElementById('plan-picker-cancel-btn');

  listEl.innerHTML = '';
  const hasPlans = plans.length > 0;
  emptyEl.hidden = hasPlans;
  listEl.hidden = !hasPlans;

  backdrop.hidden = false;

  return new Promise((resolve) => {
    function cleanup(result) {
      backdrop.hidden = true;
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onCancel() {
      cleanup(null);
    }
    cancelBtn.addEventListener('click', onCancel);

    plans.forEach((plan) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'exercise-list-item';
      const name = document.createElement('span');
      name.className = 'exercise-list-item-name';
      name.textContent = plan.name;
      item.appendChild(name);
      item.addEventListener('click', () => cleanup(plan.id));
      listEl.appendChild(item);
    });
  });
}

/**
 * "Add to Plan": converts `workout`'s structure into a new WorkoutTemplate
 * in a plan the user picks. workingSetTargets are left empty/unset for
 * RIR/RPE exercises — a finished WorkoutSet only has what was actually
 * logged, never an intended target, so there's nothing sensible to seed
 * them with; the user fills targets in afterward via the normal template
 * edit flow (Plan Builder).
 */
async function handleAddToPlan(workout) {
  const plans = await window.WorkoutRepo.getAllPlans();
  const planId = await showPlanPicker(plans);
  if (!planId) return;

  const structure = await deriveStructureFromWorkout(workout);
  const exercisesData = [];
  for (const entry of structure) {
    const exercise = await window.WorkoutRepo.getExercise(entry.exercise_id);
    const usesTargets = exercise && exercise.effortTracking !== 'none';
    exercisesData.push({
      exercise_id: entry.exercise_id,
      warmupSetCount: entry.warmupSetCount,
      workingSetCount: entry.workingSetCount,
      workingSetTargets: usesTargets ? new Array(entry.workingSetCount).fill(null) : [],
    });
  }

  const template = await window.WorkoutRepo.createWorkoutTemplate({
    plan_id: planId,
    name: workout.name || t('workout.defaultName'),
    exercises: exercisesData,
  });

  const plan = await window.WorkoutRepo.getPlan(planId);
  plan.workoutTemplateOrder.push(template.id);
  await window.WorkoutRepo.updatePlan(plan);

  await window.WorkoutDialogs.showConfirm({
    title: t('calendar.addToPlanDoneTitle'),
    message: t('calendar.addToPlanDoneMessage', { plan: plan.name }),
    confirmText: t('common.ok'),
    cancelText: '',
  });
}

// -- The 3-option choice popup ---------------------------------------------

function formatWorkoutDate(dateKey) {
  const locale = window.I18n.localeFor(getLang());
  const d = new Date(`${dateKey}T00:00:00`);
  return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

function showChoiceDialog(workout) {
  const backdrop = document.getElementById('workout-dot-choice-dialog');
  const nameEl = document.getElementById('dot-choice-workout-name');
  const viewBtn = document.getElementById('dot-choice-view-btn');
  const startBtn = document.getElementById('dot-choice-start-btn');
  const addBtn = document.getElementById('dot-choice-add-btn');
  const cancelBtn = document.getElementById('dot-choice-cancel-btn');

  const name = workout.name || t('workout.defaultName');
  nameEl.textContent = workout.date ? `${name} · ${formatWorkoutDate(workout.date)}` : name;

  backdrop.hidden = false;

  return new Promise((resolve) => {
    function cleanup(result) {
      // Hides itself before resolving, so by the time the caller opens any
      // follow-up popup (conflict dialog, plan picker), this one is already
      // gone — only one popup visible at a time.
      backdrop.hidden = true;
      viewBtn.removeEventListener('click', onView);
      startBtn.removeEventListener('click', onStart);
      addBtn.removeEventListener('click', onAdd);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onView() {
      cleanup('view');
    }
    function onStart() {
      cleanup('start');
    }
    function onAdd() {
      cleanup('add');
    }
    function onCancel() {
      cleanup(null);
    }
    viewBtn.addEventListener('click', onView);
    startBtn.addEventListener('click', onStart);
    addBtn.addEventListener('click', onAdd);
    cancelBtn.addEventListener('click', onCancel);
  });
}

async function open(workoutId) {
  const workout = await window.WorkoutRepo.getWorkout(workoutId);
  if (!workout) return;

  const choice = await showChoiceDialog(workout);

  if (choice === 'view') {
    await window.WorkoutHistoryFeature.open(workoutId);
  } else if (choice === 'start') {
    await startSameWorkout(workout);
  } else if (choice === 'add') {
    await handleAddToPlan(workout);
  }
}

/** Chooser shown when a calendar day has more than one workout. Resolves
 * with the picked workout's id, or null on Cancel. */
function showDayWorkoutsPicker(workouts, dateKey) {
  const backdrop = document.getElementById('day-workouts-dialog');
  const titleEl = document.getElementById('day-workouts-title');
  const listEl = document.getElementById('day-workouts-list');
  const cancelBtn = document.getElementById('day-workouts-cancel-btn');

  titleEl.textContent = formatWorkoutDate(dateKey);
  listEl.innerHTML = '';
  backdrop.hidden = false;

  return new Promise((resolve) => {
    function cleanup(result) {
      backdrop.hidden = true;
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onCancel() {
      cleanup(null);
    }
    cancelBtn.addEventListener('click', onCancel);

    workouts.forEach((workout) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'exercise-list-item';
      const name = document.createElement('span');
      name.className = 'exercise-list-item-name';
      name.textContent = workout.name || t('workout.defaultName');
      item.appendChild(name);
      item.addEventListener('click', () => cleanup(workout.id));
      listEl.appendChild(item);
    });
  });
}

/** Tapping a calendar day: one workout goes straight to its options; more
 * than one asks which first, so none of them is unreachable. */
async function openDay(dateKey) {
  const workouts = (await window.WorkoutRepo.getAllWorkouts()).filter((w) => w.date === dateKey);
  if (workouts.length === 0) return;
  const workoutId = workouts.length === 1 ? workouts[0].id : await showDayWorkoutsPicker(workouts, dateKey);
  if (workoutId) await open(workoutId);
}

window.WorkoutDotChoice = { open, openDay };

})();
