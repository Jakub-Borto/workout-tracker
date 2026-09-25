'use strict';

/*
 * Active Workout screen + draft workout system.
 *
 * While a workout is in progress, nothing is written to the permanent
 * workouts/sets/exerciseNotes stores — everything lives in a single draft
 * record (window.WorkoutRepo.getDraft/saveDraft/deleteDraft) until the user
 * finishes via the Finish Workout flow (window.WorkoutRepo.finishDraftWorkout).
 */

(function () {

const DAY_MS = 24 * 60 * 60 * 1000;
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

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatCountdown(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

const UNIT_SUFFIX = {
  none: '',
  kg: ' kg',
  kg_per_side: ' kg/side',
  lbs: ' lbs',
  lbs_per_side: ' lbs/side',
  centimeters: ' cm',
  meters: ' m',
  km: ' km',
  miles: ' mi',
  watts: ' W',
  resistance_level: '',
};

function formatMetricValue(unit, value) {
  if (value === null || value === undefined || value === '') return null;
  return `${value}${UNIT_SUFFIX[unit] ?? ''}`;
}

/** Input 1's column header: the exercise's metric type, e.g. "Reps". */
function metricTypeColumnLabel(metric) {
  return metric ? t(`metricType.${metric.type}`) : '';
}

/** Input 2's column header: the exercise's metric unit, e.g. "kg". Only
 * shown when the unit isn't 'none'. */
function metricUnitColumnLabel(metric) {
  return metric ? t(`unit.${metric.unit}`) : '';
}

/** One-line human summary of a set's logged values, e.g. "8 / 60 kg / RIR 2"
 * (or "L 8 / R 6" for a reps-per-side exercise). Used by the "Previous"
 * table column, the PR dialog, and Exercise History. */
function formatSetSummary(exercise, set) {
  const metric = exercise?.metric;
  const showInput2 = !!metric && !!metric.unit && metric.unit !== 'none';
  const showEffort = exercise?.effortTracking && exercise.effortTracking !== 'none';

  const parts = [];
  if (metric?.type === 'reps_per_side') {
    const left = set.input_1 != null && set.input_1 !== '' ? set.input_1 : '—';
    const right = set.input_1_right != null && set.input_1_right !== '' ? set.input_1_right : '—';
    parts.push(`${t('workout.sideLeft')} ${left} / ${t('workout.sideRight')} ${right}`);
  } else {
    parts.push(set.input_1 != null && set.input_1 !== '' ? String(set.input_1) : null);
  }
  if (showInput2) parts.push(formatMetricValue(metric.unit, set.input_2));
  if (showEffort) {
    const effortValue = exercise.effortTracking === 'rir' ? set.rir : set.rpe;
    const effortLabel = exercise.effortTracking === 'rir' ? 'RIR' : 'RPE';
    if (effortValue != null && effortValue !== '') parts.push(`${effortLabel} ${effortValue}`);
  }
  return parts.filter(Boolean).join(' / ') || '—';
}

/**
 * What kind of value each metric type/unit expects, so the workout screen
 * can auto-format what's typed. 'natural' = unsigned whole numbers,
 * 'rational' = unsigned numbers with an optional decimal point, 'time' =
 * a mm:ss / hh:mm string with the colon enforced.
 */
const INPUT_FORMAT_BY_TYPE = {
  reps: 'natural',
  reps_per_side: 'natural',
  seconds: 'natural',
  min_sec: 'time',
  hr_min: 'time',
  meters: 'natural',
};

const INPUT_FORMAT_BY_UNIT = {
  none: null,
  kg: 'rational',
  kg_per_side: 'rational',
  lbs: 'rational',
  lbs_per_side: 'rational',
  km: 'rational',
  miles: 'rational', // not spelled out explicitly; treated like km (fractional distances are common)
  centimeters: 'natural',
  meters: 'natural',
  watts: 'natural',
  resistance_level: 'natural',
};

/** Strips a live-typed string down to what its input format allows. */
function sanitizeInputValue(raw, format) {
  if (raw == null) return '';
  if (format === 'natural') {
    // Whole numbers only. Anything after a decimal separator is dropped
    // rather than merged in — "8.5" is 8, not 85.
    return raw.split(/[.,]/)[0].replace(/[^0-9]/g, '');
  }
  if (format === 'rational') {
    // Some keyboards (notably iOS with certain regional/number-pad
    // settings) only offer a comma for the decimal separator, not a dot.
    // Treat it exactly like a dot rather than stripping it, so those users
    // can still type a fractional weight at all.
    const cleaned = raw.replace(/,/g, '.').replace(/[^0-9.]/g, '');
    const firstDot = cleaned.indexOf('.');
    if (firstDot === -1) return cleaned;
    return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
  }
  if (format === 'time') {
    const digits = raw.replace(/[^0-9]/g, '').slice(0, 4);
    if (digits.length <= 2) return digits;
    return `${digits.slice(0, digits.length - 2)}:${digits.slice(-2)}`;
  }
  return raw;
}

/** Drops an exercise and everything logged for it from a draft object, in
 * place, keeping the active tab pointed at something that still exists. */
function removeExerciseFromDraft(draft, exerciseId) {
  draft.exercises = draft.exercises.filter((id) => id !== exerciseId);
  draft.sets = draft.sets.filter((s) => s.exercise_id !== exerciseId);
  if (draft.exerciseNotes) delete draft.exerciseNotes[exerciseId];
  if (draft.gymByExercise) delete draft.gymByExercise[exerciseId];
  if (draft.activeExerciseId === exerciseId) draft.activeExerciseId = draft.exercises[0] ?? null;
}

/** Shown in place of an exercise that no longer exists — e.g. deleted
 * before exercise deletion started cleaning up its history — so its tab
 * isn't a dead blank page and it can still be removed. */
function buildDeletedExercisePanel(onRemove) {
  const panel = document.createElement('div');
  panel.className = 'deleted-exercise-panel';

  const heading = document.createElement('h2');
  heading.className = 'workout-exercise-name';
  heading.textContent = t('workout.deletedExercise');

  const message = document.createElement('p');
  message.className = 'empty-state-subtitle';
  message.textContent = t('workout.deletedExerciseMessage');

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'workout-action-btn workout-action-btn-danger';
  removeBtn.textContent = t('workout.remove');
  removeBtn.addEventListener('click', onRemove);

  panel.append(heading, message, removeBtn);
  return panel;
}

function isBlankValue(value) {
  return value == null || value === '';
}

/** Whether a set has the values it needs to count as logged: its main
 * value (either side, for per-side metrics) and, when the metric has a unit
 * (e.g. kg), that too. Shared by the active workout's "done" checkbox and
 * the past-workout editor's Save, so both use the same rule. */
function setHasRequiredValues(exercise, set) {
  const metric = exercise?.metric;
  const mainMissing =
    metric?.type === 'reps_per_side'
      ? isBlankValue(set.input_1) && isBlankValue(set.input_1_right)
      : isBlankValue(set.input_1);
  const needsInput2 = !!metric?.unit && metric.unit !== 'none';
  return !mainMissing && !(needsInput2 && isBlankValue(set.input_2));
}

// RIR is picked from a fixed 0-6+ scale (not free-typed) via a color-coded
// popup — red (0, hardest) through blue (6+, easiest/most reps in reserve).
const RIR_OPTIONS = ['0', '1', '2', '3', '4', '5', '6+'];
const RIR_COLORS = {
  0: '#ef4444',
  1: '#f97316',
  2: '#f59e0b',
  3: '#eab308',
  4: '#84cc16',
  5: '#22c55e',
  '6+': '#3b82f6',
};

// RPE is picked from a fixed 1-10 scale (not free-typed) via a color-coded
// popup too — blue (1, easiest) through red (10, maximum effort). Opposite
// direction from RIR's gradient since the two scales run opposite ways
// (low RIR = hard, high RPE = hard), but "red always means hardest" either way.
const RPE_OPTIONS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
const RPE_COLORS = {
  1: '#3b82f6',
  2: '#0ea5e9',
  3: '#14b8a6',
  4: '#22c55e',
  5: '#84cc16',
  6: '#eab308',
  7: '#f59e0b',
  8: '#f97316',
  9: '#ef4444',
  10: '#b91c1c',
};

function playBeep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [0, 0.22, 0.44].forEach((delay) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.value = 0.15;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const startAt = ctx.currentTime + delay;
      osc.start(startAt);
      osc.stop(startAt + 0.15);
    });
    setTimeout(() => ctx.close().catch(() => {}), 900);
  } catch (err) {
    console.error('Failed to play timer beep', err);
  }
}

// -- Popup queue (prevents startup dialogs from overlapping) --------------
//
// Multiple things can each want to show a blocking dialog around app
// startup: the draft-expiry check (this file), the backup reminder
// (backup.js), and the "what's new" update popup (updates.js). The first
// two are already sequential via app.js's own await chain, but the update
// popup is fundamentally different — it's triggered by an async
// service-worker message that can arrive at any time, completely
// independent of that startup sequence. Without coordination, it could pop
// up on top of (or underneath, invisibly) one of the other two.
// runExclusive() chains every popup-showing call onto a single promise
// tail so they always show one at a time, in the order requested, instead
// of two ever being open simultaneously.
let popupQueueTail = Promise.resolve();

function runExclusive(fn) {
  const result = popupQueueTail.then(() => fn());
  // Swallow errors in the tail itself (not in what callers receive) so one
  // popup throwing never wedges the queue for everything queued after it.
  popupQueueTail = result.then(
    () => {},
    () => {}
  );
  return result;
}

// -- Generic confirm dialog ----------------------------------------------

function showConfirm({ title, message, confirmText, cancelText }) {
  const backdrop = document.getElementById('confirm-dialog');
  const titleEl = document.getElementById('confirm-title');
  const messageEl = document.getElementById('confirm-message');
  const okBtn = document.getElementById('confirm-ok-btn');
  const cancelBtn = document.getElementById('confirm-cancel-btn');

  titleEl.textContent = title;
  messageEl.textContent = message;
  okBtn.textContent = confirmText ?? t('common.yes');
  // Hidden only when a caller explicitly passes '' (a forced binary choice
  // with no "go back" option); shown by default so every other confirm
  // always has a way to back out.
  cancelBtn.hidden = cancelText === '';
  cancelBtn.textContent = cancelText || t('common.cancel');

  backdrop.hidden = false;

  return new Promise((resolve) => {
    function cleanup(result) {
      backdrop.hidden = true;
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onOk() {
      cleanup(true);
    }
    function onCancel() {
      cleanup(false);
    }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

// -- Generic single-text-field name prompt ("Create Workout Plan", etc.) --

/** Resolves with the trimmed text on OK (empty string if blank — caller
 * decides whether that's acceptable), or null on Cancel. */
/** `emptyError`, when given, makes a blank value invalid: it's shown under
 * the field and the prompt stays open instead of resolving with ''. */
function showTextPrompt({ title, initialValue = '', confirmText, cancelText, emptyError }) {
  const backdrop = document.getElementById('text-prompt-dialog');
  const titleEl = document.getElementById('text-prompt-title');
  const input = document.getElementById('text-prompt-input');
  const errorEl = document.getElementById('text-prompt-error');
  const confirmBtn = document.getElementById('text-prompt-confirm-btn');
  const cancelBtn = document.getElementById('text-prompt-cancel-btn');

  titleEl.textContent = title;
  errorEl.hidden = true;
  input.value = initialValue;
  confirmBtn.textContent = confirmText ?? t('common.ok');
  cancelBtn.textContent = cancelText ?? t('common.cancel');

  backdrop.hidden = false;
  input.focus();

  return new Promise((resolve) => {
    function cleanup(result) {
      backdrop.hidden = true;
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKeydown);
      resolve(result);
    }
    function onConfirm() {
      const value = input.value.trim();
      if (!value && emptyError) {
        errorEl.textContent = emptyError;
        errorEl.hidden = false;
        input.focus();
        return;
      }
      cleanup(value);
    }
    function onCancel() {
      cleanup(null);
    }
    function onKeydown(e) {
      if (e.key === 'Enter') onConfirm();
    }
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKeydown);
  });
}

// -- Finish Workout name + date dialog -----------------------------------

/** Resolves with `{ name, date }`, or null on Cancel. A draft still carrying
 * the generic default name ("Workout") opens with the field empty — the
 * default shows as the placeholder instead — so naming it means just
 * typing, not deleting "Workout" first. Left blank, it falls back to that
 * same default. */
function showFinishDialog({ defaultName, defaultDate }) {
  const backdrop = document.getElementById('finish-workout-dialog');
  const nameInput = document.getElementById('finish-name-input');
  const dateInput = document.getElementById('finish-date-input');
  const confirmBtn = document.getElementById('finish-dialog-confirm-btn');
  const cancelBtn = document.getElementById('finish-dialog-cancel-btn');

  const genericName = t('workout.defaultName');
  nameInput.value = defaultName && defaultName !== genericName ? defaultName : '';
  dateInput.value = defaultDate;
  backdrop.hidden = false;

  return new Promise((resolve) => {
    function cleanup(result) {
      backdrop.hidden = true;
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onConfirm() {
      cleanup({
        name: nameInput.value.trim() || genericName,
        date: dateInput.value || defaultDate,
      });
    }
    function onCancel() {
      cleanup(null);
    }
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
  });
}

// -- Exercise picker (shared: add exercise / swap exercise) --------------

class ExercisePickerController {
  constructor() {
    this.overlay = document.getElementById('exercise-picker');
    this.titleEl = document.getElementById('picker-title');
    this.searchInput = document.getElementById('picker-search-input');
    this.listEl = document.getElementById('picker-list');
    this.cancelBtn = document.getElementById('picker-cancel-btn');
    this.addExerciseBtn = document.getElementById('picker-add-exercise-btn');
    this.filterOpenBtn = document.getElementById('picker-filter-open-btn');
    this.filterBadge = document.getElementById('picker-filter-badge');

    this.exercises = [];
    this.excludeIds = new Set();
    this.selectedFilterGroups = new Set();
    this.onPick = null;

    this.filterSheet = new window.WorkoutExercisesFeature.MuscleFilterSheetController({
      onApply: (set) => {
        this.selectedFilterGroups = set;
        this.updateFilterBadge();
        this.render();
      },
      ids: {
        overlayId: 'picker-muscle-filter-sheet',
        containerId: 'picker-filter-muscle-groups',
        cancelBtnId: 'picker-filter-cancel-btn',
        applyBtnId: 'picker-filter-apply-btn',
        clearBtnId: 'picker-filter-clear-btn',
      },
    });

    this.searchInput.addEventListener('input', () => this.render());
    this.cancelBtn.addEventListener('click', () => this.close());
    this.addExerciseBtn.addEventListener('click', () => this.handleCreateExercise());
    this.filterOpenBtn.addEventListener('click', () => this.filterSheet.open(this.selectedFilterGroups));
  }

  updateFilterBadge() {
    const n = this.selectedFilterGroups.size;
    this.filterBadge.hidden = n === 0;
    this.filterBadge.textContent = String(n);
  }

  /** Opens the same shared Create/Edit Exercise screen used from the
   * Exercises tab, so a new exercise can be created without leaving the
   * picker flow. Saving it auto-picks the new exercise (the whole reason
   * for being in this picker), same as tapping it in the list would;
   * cancelling just returns to the picker, refreshed in case anything
   * else changed underneath it. */
  handleCreateExercise() {
    const editor = window.WorkoutExercisesFeature.editor;
    if (!editor) return;

    this.overlay.hidden = true;
    editor.open(null, {
      onClose: async (result) => {
        if (result && result.saved) {
          if (this.onPick) this.onPick(result.saved.id);
          return;
        }
        this.exercises = await window.WorkoutRepo.getAllExercises();
        this.render();
        this.overlay.hidden = false;
      },
    });
  }

  async open({ excludeIds = [], titleKey = 'workout.pickExerciseTitleAdd', onPick }) {
    this.excludeIds = new Set(excludeIds);
    this.onPick = onPick;
    this.titleEl.dataset.i18n = titleKey;
    this.titleEl.textContent = t(titleKey);
    this.searchInput.value = '';
    this.exercises = await window.WorkoutRepo.getAllExercises();
    this.render();
    this.overlay.hidden = false;
  }

  close() {
    this.overlay.hidden = true;
  }

  render() {
    const query = this.searchInput.value.trim().toLowerCase();
    const filtered = this.exercises
      .filter((ex) => !this.excludeIds.has(ex.id))
      .filter((ex) => !query || ex.name.toLowerCase().includes(query))
      .filter(
        (ex) => this.selectedFilterGroups.size === 0 || ex.muscleGroups.some((g) => this.selectedFilterGroups.has(g))
      )
      // Favorites always lead, same as the Exercises tab — filters still
      // narrow the list first, favorites just sort first within that.
      .sort((a, b) => {
        if (!!a.isFavorite !== !!b.isFavorite) return a.isFavorite ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    this.listEl.innerHTML = '';
    filtered.forEach((ex) => {
      const row = document.createElement('div');
      row.className = 'exercise-list-row';

      const favBtn = document.createElement('button');
      favBtn.type = 'button';
      favBtn.className = 'exercise-favorite-btn';
      favBtn.classList.toggle('is-favorite', !!ex.isFavorite);
      favBtn.setAttribute('aria-pressed', String(!!ex.isFavorite));
      favBtn.setAttribute('aria-label', t('exercise.favoriteToggle'));
      favBtn.innerHTML = window.WorkoutIcons.starIconSvg(!!ex.isFavorite);
      favBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const updated = await window.WorkoutRepo.toggleExerciseFavorite(ex.id);
        if (!updated) return;
        ex.isFavorite = updated.isFavorite;
        this.render();
      });

      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'exercise-list-item';
      const name = document.createElement('span');
      name.className = 'exercise-list-item-name';
      name.textContent = ex.name;
      item.appendChild(name);
      item.addEventListener('click', () => {
        this.close();
        if (this.onPick) this.onPick(ex.id);
      });

      row.append(favBtn, item);
      this.listEl.appendChild(row);
    });
  }
}

// -- RIR picker (color-coded 0-6+ popup) ----------------------------------

class RirPickerController {
  constructor() {
    this.backdrop = document.getElementById('rir-picker');
    this.grid = document.getElementById('rir-picker-grid');
    this.clearBtn = document.getElementById('rir-picker-clear-btn');
    this.onPick = null;

    this.render();
    this.clearBtn.addEventListener('click', () => this.select(''));
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.close();
    });
  }

  render() {
    this.grid.innerHTML = '';
    RIR_OPTIONS.forEach((value) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rir-picker-option';
      btn.style.background = RIR_COLORS[value];
      btn.textContent = value;
      btn.addEventListener('click', () => this.select(value));
      this.grid.appendChild(btn);
    });
  }

  select(value) {
    const onPick = this.onPick;
    this.close();
    if (onPick) onPick(value);
  }

  open(onPick) {
    this.onPick = onPick;
    this.backdrop.hidden = false;
  }

  close() {
    this.backdrop.hidden = true;
  }
}

// -- RPE picker (color-coded 1-10 popup) ----------------------------------

class RpePickerController {
  constructor() {
    this.backdrop = document.getElementById('rpe-picker');
    this.grid = document.getElementById('rpe-picker-grid');
    this.clearBtn = document.getElementById('rpe-picker-clear-btn');
    this.onPick = null;

    this.render();
    this.clearBtn.addEventListener('click', () => this.select(''));
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.close();
    });
  }

  render() {
    this.grid.innerHTML = '';
    RPE_OPTIONS.forEach((value) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rir-picker-option';
      btn.style.background = RPE_COLORS[value];
      btn.textContent = value;
      btn.addEventListener('click', () => this.select(value));
      this.grid.appendChild(btn);
    });
  }

  select(value) {
    const onPick = this.onPick;
    this.close();
    if (onPick) onPick(value);
  }

  open(onPick) {
    this.onPick = onPick;
    this.backdrop.hidden = false;
  }

  close() {
    this.backdrop.hidden = true;
  }
}

// -- Note editor (this session's in-progress ExerciseNote draft) ---------

class NoteEditorController {
  constructor() {
    this.overlay = document.getElementById('note-editor');
    this.globalSection = document.getElementById('note-editor-global-section');
    this.globalText = document.getElementById('note-editor-global-text');
    this.previousSection = document.getElementById('note-editor-previous-section');
    this.previousText = document.getElementById('note-editor-previous-text');
    this.textarea = document.getElementById('note-textarea');
    this.cancelBtn = document.getElementById('note-cancel-btn');
    this.saveBtn = document.getElementById('note-save-btn');
    this.onSave = null;

    this.cancelBtn.addEventListener('click', () => this.close());
    this.saveBtn.addEventListener('click', () => {
      const text = this.textarea.value;
      this.close();
      if (this.onSave) this.onSave(text);
    });
  }

  open({ initialText = '', globalNoteText = '', previousNoteText = '', onSave }) {
    this.globalSection.hidden = !globalNoteText;
    this.globalText.textContent = globalNoteText;
    this.previousSection.hidden = !previousNoteText;
    this.previousText.textContent = previousNoteText;
    this.textarea.value = initialText;
    this.onSave = onSave;
    this.overlay.hidden = false;
  }

  close() {
    this.overlay.hidden = true;
  }
}

// -- Gym picker (which gym an exercise's sets in this workout belong to) --

class GymPickerController {
  constructor() {
    this.backdrop = document.getElementById('gym-picker');
    this.list = document.getElementById('gym-picker-list');
    this.onPick = null;

    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.close();
    });
  }

  async open(currentGymId, onPick) {
    this.onPick = onPick;
    const lang = getLang();
    const gyms = await window.WorkoutRepo.getAllGyms();
    gyms.sort((a, b) => {
      if (a.id === GENERAL_GYM_ID) return -1;
      if (b.id === GENERAL_GYM_ID) return 1;
      return a.name.localeCompare(b.name);
    });

    this.list.innerHTML = '';
    gyms.forEach((gym) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gym-picker-option';
      if (gym.id === currentGymId) btn.classList.add('is-active');
      btn.textContent = gym.id === GENERAL_GYM_ID ? window.I18n.t('gyms.general', lang) : gym.name;
      btn.addEventListener('click', () => this.select(gym.id));
      this.list.appendChild(btn);
    });

    this.backdrop.hidden = false;
  }

  select(gymId) {
    const onPick = this.onPick;
    this.close();
    if (onPick) onPick(gymId);
  }

  close() {
    this.backdrop.hidden = true;
  }
}

// -- Personal Record dialog -----------------------------------------------

class PRDialogController {
  constructor() {
    this.backdrop = document.getElementById('pr-dialog');
    this.currentBestEl = document.getElementById('pr-current-best');
    this.markBtn = document.getElementById('pr-mark-btn');
    this.closeBtn = document.getElementById('pr-close-btn');

    this.exercise = null;
    this.exerciseId = null;
    this.gymId = null;
    this.gymName = '';
    this.getCurrentSets = null;

    this.closeBtn.addEventListener('click', () => this.close());
    this.markBtn.addEventListener('click', () => this.handleMark());
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.close();
    });
  }

  /** `getCurrentSets` returns the caller's live set array for this exercise
   * at open-time, read fresh when "Mark as PR" is pressed (not snapshotted
   * on open), so edits made while the dialog is open aren't stale.
   * `beforeDate`, when given (Workout Detail passes the workout's own
   * date), excludes any PR dated on or after it — no look-ahead bias when
   * reviewing an old workout. Omitted (Active Workout) means no cutoff. */
  async open({ exercise, exerciseId, gymId, gymName, getCurrentSets, beforeDate }) {
    this.exercise = exercise;
    this.exerciseId = exerciseId;
    this.gymId = gymId;
    this.gymName = gymName;
    this.getCurrentSets = getCurrentSets;
    this.beforeDate = beforeDate ?? null;
    await this.renderCurrentBest();
    this.backdrop.hidden = false;
  }

  async renderCurrentBest() {
    const pr = await window.WorkoutRepo.getLatestPR(this.exerciseId, this.gymId, this.beforeDate);
    this.currentBestEl.innerHTML = '';

    const gymLabel = document.createElement('p');
    gymLabel.className = 'pr-gym-label';
    gymLabel.textContent = this.gymName;
    this.currentBestEl.appendChild(gymLabel);

    if (!pr || pr.sets.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'pr-empty';
      empty.textContent = t('workout.prNone');
      this.currentBestEl.appendChild(empty);
      return;
    }

    if (pr.date) {
      const dateEl = document.createElement('p');
      dateEl.className = 'pr-current-best-date';
      dateEl.textContent = pr.date;
      this.currentBestEl.appendChild(dateEl);
    }

    const ordered = pr.sets.slice().sort((a, b) => {
      if (a.is_warmup_set !== b.is_warmup_set) return a.is_warmup_set ? -1 : 1;
      return (a.set_number ?? 0) - (b.set_number ?? 0);
    });
    ordered.forEach((set) => {
      const line = document.createElement('p');
      line.className = 'pr-set-line';
      const label = `${set.is_warmup_set ? 'W' : ''}${set.set_number}`;
      line.textContent = `${label}: ${formatSetSummary(this.exercise, set)}`;
      this.currentBestEl.appendChild(line);
    });
  }

  async handleMark() {
    const currentSets = this.getCurrentSets ? this.getCurrentSets() : [];
    if (currentSets.length === 0) return;

    // Hide this dialog while the confirm prompt is up so only one popup is
    // ever visible at once.
    this.backdrop.hidden = true;
    const confirmed = await showConfirm({
      title: t('workout.confirmMarkPRTitle'),
      message: t('workout.confirmMarkPRMessage'),
      confirmText: t('workout.prMarkButton'),
    });
    if (!confirmed) {
      this.backdrop.hidden = false; // cancelled: back to the PR dialog, unchanged
      return;
    }

    const snapshot = currentSets.map((s) => ({
      set_number: s.set_number,
      is_warmup_set: s.is_warmup_set,
      input_1: s.input_1,
      input_1_right: s.input_1_right,
      input_2: s.input_2,
      rir: s.rir,
      rpe: s.rpe,
    }));
    await window.WorkoutRepo.createPR({
      exercise_id: this.exerciseId,
      gym_id: this.gymId,
      date: todayDateKey(),
      sets: snapshot,
    });
    // Marked successfully: close instead of reopening the PR dialog. This
    // appends a new PR entry — it never overwrites earlier ones (see
    // WorkoutRepo.getPRHistory / the Exercise History screen's PR tab).
  }

  close() {
    this.backdrop.hidden = true;
  }
}

// -- Shared hand-rolled SVG charts (no charting library) -------------------
//
// Used by Exercise History's per-exercise line chart and by the Stats tab's
// muscle-group / PR-over-time charts. Deliberately dumb: callers own their
// own caption/tooltip UI and pass a `formatValue`/`onSelect` callback rather
// than this module knowing anything about what a "point" or "bar" means.

/** A line chart for a chronological series. `points`: [{ date, value }],
 * oldest first. `onSelect(point)` fires when a dot is tapped (the last
 * point starts pre-selected). Returns the <svg> element. */
function buildLineChartSvg(points, { formatValue, onSelect } = {}) {
  const fmt = formatValue || ((v) => String(v));
  const width = 320;
  const height = 180;
  const padLeft = 40;
  const padRight = 14;
  const padTop = 18;
  const padBottom = 26;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const values = points.map((p) => p.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const span = maxV - minV || Math.max(1, maxV * 0.1) || 1;
  const yMin = minV - span * 0.15;
  const yMax = maxV + span * 0.15;

  const xFor = (i) => padLeft + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const yFor = (v) => padTop + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'exercise-chart-svg');

  [padTop, padTop + plotH].forEach((y) => {
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', padLeft);
    line.setAttribute('x2', width - padRight);
    line.setAttribute('y1', y);
    line.setAttribute('y2', y);
    line.setAttribute('class', 'exercise-chart-grid');
    svg.appendChild(line);
  });

  const maxLabel = document.createElementNS(svgNS, 'text');
  maxLabel.setAttribute('x', 2);
  maxLabel.setAttribute('y', padTop + 4);
  maxLabel.setAttribute('class', 'exercise-chart-axis-label');
  maxLabel.textContent = fmt(maxV);
  svg.appendChild(maxLabel);

  const minLabel = document.createElementNS(svgNS, 'text');
  minLabel.setAttribute('x', 2);
  minLabel.setAttribute('y', padTop + plotH + 4);
  minLabel.setAttribute('class', 'exercise-chart-axis-label');
  minLabel.textContent = fmt(minV);
  svg.appendChild(minLabel);

  const firstDateLabel = document.createElementNS(svgNS, 'text');
  firstDateLabel.setAttribute('x', padLeft);
  firstDateLabel.setAttribute('y', height - 6);
  firstDateLabel.setAttribute('class', 'exercise-chart-axis-label');
  firstDateLabel.setAttribute('text-anchor', 'start');
  firstDateLabel.textContent = points[0].date;
  svg.appendChild(firstDateLabel);

  if (points.length > 1) {
    const lastDateLabel = document.createElementNS(svgNS, 'text');
    lastDateLabel.setAttribute('x', width - padRight);
    lastDateLabel.setAttribute('y', height - 6);
    lastDateLabel.setAttribute('class', 'exercise-chart-axis-label');
    lastDateLabel.setAttribute('text-anchor', 'end');
    lastDateLabel.textContent = points[points.length - 1].date;
    svg.appendChild(lastDateLabel);

    const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(p.value)}`).join(' ');
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', pathD);
    path.setAttribute('class', 'exercise-chart-line');
    svg.appendChild(path);
  }

  const dots = [];
  points.forEach((p, i) => {
    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('cx', xFor(i));
    circle.setAttribute('cy', yFor(p.value));
    circle.setAttribute('r', i === points.length - 1 ? 6 : 5);
    circle.setAttribute('class', 'exercise-chart-dot');
    if (i === points.length - 1) circle.classList.add('is-active');
    circle.addEventListener('click', () => {
      dots.forEach((d) => d.classList.remove('is-active'));
      circle.classList.add('is-active');
      if (onSelect) onSelect(p);
    });
    svg.appendChild(circle);
    dots.push(circle);
  });

  return svg;
}

/** A horizontal bar chart — reads better than vertical columns once there
 * are more than a handful of categories (e.g. 18 muscle groups) on a narrow
 * phone screen. `bars`: [{ label, value }], rendered in the given order
 * (sort before calling if you want ranked order). Returns the <svg>. */
function buildBarChartSvg(bars, { formatValue } = {}) {
  const fmt = formatValue || ((v) => String(v));
  const rowHeight = 24;
  const barMaxWidth = 170;
  const labelWidth = 96;
  const valueWidth = 30;
  const width = labelWidth + barMaxWidth + valueWidth;
  const height = bars.length * rowHeight + 4;
  const maxValue = Math.max(...bars.map((b) => b.value), 1);

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'exercise-chart-svg stats-bar-chart-svg');

  bars.forEach((bar, i) => {
    const y = 4 + i * rowHeight;
    const barW = Math.max((bar.value / maxValue) * barMaxWidth, bar.value > 0 ? 2 : 0);

    const label = document.createElementNS(svgNS, 'text');
    label.setAttribute('x', 0);
    label.setAttribute('y', y + rowHeight / 2 + 3);
    label.setAttribute('class', 'exercise-chart-axis-label stats-bar-label');
    label.textContent = bar.label;
    svg.appendChild(label);

    const track = document.createElementNS(svgNS, 'rect');
    track.setAttribute('x', labelWidth);
    track.setAttribute('y', y);
    track.setAttribute('width', barMaxWidth);
    track.setAttribute('height', rowHeight - 10);
    track.setAttribute('rx', 3);
    track.setAttribute('class', 'stats-bar-track');
    svg.appendChild(track);

    const fill = document.createElementNS(svgNS, 'rect');
    fill.setAttribute('x', labelWidth);
    fill.setAttribute('y', y);
    fill.setAttribute('width', barW);
    fill.setAttribute('height', rowHeight - 10);
    fill.setAttribute('rx', 3);
    fill.setAttribute('class', 'stats-bar-fill');
    svg.appendChild(fill);

    const valueLabel = document.createElementNS(svgNS, 'text');
    valueLabel.setAttribute('x', labelWidth + barMaxWidth + 6);
    valueLabel.setAttribute('y', y + rowHeight / 2 + 3);
    valueLabel.setAttribute('class', 'exercise-chart-axis-label stats-bar-value');
    valueLabel.textContent = fmt(bar.value);
    svg.appendChild(valueLabel);
  });

  return svg;
}

window.WorkoutCharts = { buildLineChartSvg, buildBarChartSvg };

// -- Auto-fill new sets from previous workout -----------------------------
//
// Shared by the Active Workout screen's own "Add Set"/"Add Warmup" buttons
// and (in a future segment) starting a workout from a Plan template — both
// need the exact same "what should this brand-new set start out as" rule,
// so it lives here as one pure function rather than being duplicated.

/** Digit-only reps value + 1, e.g. "8" -> "9". Returns the value unchanged
 * if it's empty/not a plain integer (defensive — should never see anything
 * else for a 'natural'-formatted reps field, but never crash on odd data). */
function incrementRepsValue(value) {
  if (value == null || value === '') return value;
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return value;
  return String(n + 1);
}

/**
 * What a brand-new set's input_1/input_1_right/input_2 should start out as,
 * given the exercise being logged and the previously-logged sets to match
 * against (already resolved for the relevant gym filter by the caller, e.g.
 * WorkoutRepo.getLastLoggedSetsForExercise). Matched by exercise + set
 * number + warmup/working status (the caller passes sets already scoped to
 * one exercise). Warm-up sets are copied exactly; working sets get +1 on
 * input_1/input_1_right when the exercise's metric type is 'reps' or
 * 'reps_per_side' (the only types where "one more rep than last time" makes
 * sense), everything else copied unchanged. input_2 (the second metric,
 * e.g. weight) is never incremented — progression there is a deliberate
 * user decision, not an automatic guess. No match (e.g. first time ever
 * doing this exercise, or a new set number never logged before) leaves
 * every field empty, same as today's baseline behavior.
 */
function computeAutoFillValues(exercise, previousSets, setNumber, isWarmup) {
  const match = (previousSets ?? []).find(
    (s) => (s.is_warmup_set ?? false) === isWarmup && (s.set_number ?? null) === setNumber
  );
  if (!match) return { input_1: null, input_1_right: null, input_2: null };

  const metricType = exercise?.metric?.type;
  const isRepsMetric = metricType === 'reps' || metricType === 'reps_per_side';
  const shouldIncrement = !isWarmup && isRepsMetric;

  return {
    input_1: shouldIncrement ? incrementRepsValue(match.input_1) : match.input_1 ?? null,
    input_1_right: shouldIncrement ? incrementRepsValue(match.input_1_right) : match.input_1_right ?? null,
    input_2: match.input_2 ?? null,
  };
}

window.WorkoutAutoFill = { computeAutoFillValues };

// -- Exercise History (read-only, shared by the Stats tab picker and the
// Active Workout action row) -----------------------------------------------

/**
 * Read-only drill-in into every set ever logged for one exercise: a gym
 * filter (All + one chip per custom gym — General is never a filter option
 * here, this is a plain literal filter unlike the "General ignores gym"
 * convention used by getLastLoggedSetsForExercise/getPreviousLoggedSetsForExercise),
 * then every workout that includes this exercise as a date-labeled cluster
 * of sets, newest first. No editing, no navigation into Workout Detail —
 * purely a history browser.
 */
class ExerciseHistoryController {
  constructor() {
    this.overlay = document.getElementById('exercise-history-screen');
    this.closeBtn = document.getElementById('exercise-history-close-btn');
    this.titleEl = document.getElementById('exercise-history-title');
    this.viewTabs = document.getElementById('exercise-history-view-tabs');
    this.filterRow = document.getElementById('exercise-history-filter-row');
    this.listEl = document.getElementById('exercise-history-list');
    this.prListEl = document.getElementById('exercise-history-pr-list');
    this.chartEl = document.getElementById('exercise-history-chart');
    this.emptyStateEl = document.getElementById('exercise-history-empty-state');
    this.emptyTitleEl = document.getElementById('exercise-history-empty-title');

    this.exercise = null;
    this.exerciseId = null;
    this.gyms = []; // custom gyms only, General excluded from this filter
    this.selectedGymId = 'all';
    this.viewMode = 'history'; // 'history' | 'pr' | 'chart'
    this.groups = []; // every {workoutId, date, sets[]} for this exercise, unfiltered
    this.prRecords = []; // every PR ever marked for this exercise, unfiltered, newest first

    this.closeBtn.addEventListener('click', () => this.close());
    this.viewTabs.querySelectorAll('.segmented-option').forEach((btn) => {
      btn.addEventListener('click', () => this.selectView(btn.dataset.view));
    });
    window.addEventListener('app:languagechange', () => {
      if (!this.overlay.hidden) this.render();
    });
  }

  /** `initialGymId`: 'all', or a gym id to preselect (falls back to 'all'
   * if that gym isn't a valid filter option here, e.g. General or a gym
   * that no longer exists). */
  async open(exerciseId, { initialGymId = 'all' } = {}) {
    this.exerciseId = exerciseId;
    this.exercise = await window.WorkoutRepo.getExercise(exerciseId);
    if (!this.exercise) return;

    const allGyms = await window.WorkoutRepo.getAllGyms();
    this.gyms = allGyms.filter((g) => g.id !== GENERAL_GYM_ID).sort((a, b) => a.name.localeCompare(b.name));
    this.selectedGymId = this.gyms.some((g) => g.id === initialGymId) ? initialGymId : 'all';

    this.groups = await window.WorkoutRepo.getExerciseHistory(exerciseId);
    this.prRecords = await window.WorkoutRepo.getPRHistory(exerciseId, 'all');

    this.selectView('history');
    this.titleEl.textContent = this.exercise.name;
    this.overlay.hidden = false;
    this.render();
  }

  close() {
    this.overlay.hidden = true;
  }

  selectView(view) {
    this.viewMode = view;
    this.viewTabs.querySelectorAll('.segmented-option').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.view === view);
    });
    this.render();
  }

  selectGym(gymId) {
    this.selectedGymId = gymId;
    this.render();
  }

  gymNameFor(gymId) {
    if (gymId === GENERAL_GYM_ID) return t('gyms.general');
    return this.gyms.find((g) => g.id === gymId)?.name ?? t('gyms.general');
  }

  renderFilterRow() {
    this.filterRow.innerHTML = '';

    const allChip = document.createElement('button');
    allChip.type = 'button';
    allChip.className = 'chip';
    if (this.selectedGymId === 'all') allChip.classList.add('is-selected');
    allChip.textContent = t('workout.gymFilterAll');
    allChip.addEventListener('click', () => this.selectGym('all'));
    this.filterRow.appendChild(allChip);

    this.gyms.forEach((gym) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      if (this.selectedGymId === gym.id) chip.classList.add('is-selected');
      chip.textContent = gym.name;
      chip.addEventListener('click', () => this.selectGym(gym.id));
      this.filterRow.appendChild(chip);
    });
  }

  /** Sets grouped by workout, filtered to the selected gym — the same
   * literal (non-"General ignores gym") filter used across every view here. */
  getVisibleGroups() {
    if (this.selectedGymId === 'all') return this.groups;
    return this.groups
      .map((g) => ({ ...g, sets: g.sets.filter((s) => (s.gym_id ?? GENERAL_GYM_ID) === this.selectedGymId) }))
      .filter((g) => g.sets.length > 0);
  }

  render() {
    this.renderFilterRow();

    this.listEl.hidden = this.viewMode !== 'history';
    this.prListEl.hidden = this.viewMode !== 'pr';
    this.chartEl.hidden = this.viewMode !== 'chart';

    if (this.viewMode === 'history') this.renderHistoryView();
    else if (this.viewMode === 'pr') this.renderPrView();
    else this.renderChartView();
  }

  renderHistoryView() {
    const visibleGroups = this.getVisibleGroups();

    this.listEl.innerHTML = '';
    const hasAnyHistory = this.groups.length > 0;
    const hasFilteredResults = visibleGroups.length > 0;

    this.emptyStateEl.hidden = hasFilteredResults;
    this.listEl.hidden = !hasFilteredResults;

    if (!hasFilteredResults) {
      this.emptyTitleEl.textContent = hasAnyHistory ? t('workout.historyNoResultsForFilter') : t('workout.historyEmpty');
      return;
    }

    visibleGroups.forEach((group) => this.listEl.appendChild(this.buildCluster(group)));
  }

  buildCluster(group) {
    const card = document.createElement('div');
    card.className = 'history-cluster';

    const dateEl = document.createElement('p');
    dateEl.className = 'history-cluster-date';
    dateEl.textContent = group.date ?? '';
    card.appendChild(dateEl);

    const setsWrap = document.createElement('div');
    setsWrap.className = 'history-cluster-sets';
    group.sets.forEach((set) => {
      const row = document.createElement('div');
      row.className = 'history-set-row';

      const label = document.createElement('span');
      label.className = 'history-set-label';
      label.textContent = `${set.is_warmup_set ? 'W' : ''}${set.set_number}`;

      const value = document.createElement('span');
      value.className = 'history-set-value';
      value.textContent = formatSetSummary(this.exercise, set);

      row.append(label, value);
      setsWrap.appendChild(row);
    });
    card.appendChild(setsWrap);

    return card;
  }

  // -- PR view: every PR ever marked, newest first -------------------------

  renderPrView() {
    const visiblePrs =
      this.selectedGymId === 'all' ? this.prRecords : this.prRecords.filter((pr) => pr.gym_id === this.selectedGymId);

    this.prListEl.innerHTML = '';
    const hasAny = this.prRecords.length > 0;
    const hasFiltered = visiblePrs.length > 0;

    this.emptyStateEl.hidden = hasFiltered;
    this.prListEl.hidden = !hasFiltered;

    if (!hasFiltered) {
      this.emptyTitleEl.textContent = hasAny ? t('workout.prHistoryNoResultsForFilter') : t('workout.prHistoryEmpty');
      return;
    }

    visiblePrs.forEach((pr) => this.prListEl.appendChild(this.buildPrEntry(pr)));
  }

  buildPrEntry(pr) {
    const card = document.createElement('div');
    card.className = 'history-cluster';

    const dateEl = document.createElement('p');
    dateEl.className = 'history-cluster-date';
    dateEl.textContent =
      this.selectedGymId === 'all' ? `${pr.date ?? ''} · ${this.gymNameFor(pr.gym_id)}` : pr.date ?? '';
    card.appendChild(dateEl);

    const setsWrap = document.createElement('div');
    setsWrap.className = 'history-cluster-sets';
    pr.sets
      .slice()
      .sort((a, b) => {
        if (a.is_warmup_set !== b.is_warmup_set) return a.is_warmup_set ? -1 : 1;
        return (a.set_number ?? 0) - (b.set_number ?? 0);
      })
      .forEach((set) => {
        const row = document.createElement('div');
        row.className = 'history-set-row';

        const label = document.createElement('span');
        label.className = 'history-set-label';
        label.textContent = `${set.is_warmup_set ? 'W' : ''}${set.set_number}`;

        const value = document.createElement('span');
        value.className = 'history-set-value';
        value.textContent = formatSetSummary(this.exercise, set);

        row.append(label, value);
        setsWrap.appendChild(row);
      });
    card.appendChild(setsWrap);

    return card;
  }

  // -- Chart view: max working-set value per workout, over time -----------

  /** The number this chart tracks for one set: the unit value (e.g. kg) when
   * there is one, else the type value (e.g. reps, meters, seconds). Mirrors
   * the heuristic used to pick which workout becomes a PR candidate. */
  chartValueForSet(set) {
    const v2 = parseFloat(set.input_2);
    if (!Number.isNaN(v2)) return v2;
    const v1 = parseFloat(set.input_1);
    return Number.isNaN(v1) ? null : v1;
  }

  computeChartPoints(visibleGroups) {
    return visibleGroups
      .map((g) => {
        const values = g.sets
          .filter((s) => !s.is_warmup_set)
          .map((s) => this.chartValueForSet(s))
          .filter((v) => v != null);
        if (values.length === 0) return null;
        return { date: g.date, value: Math.max(...values) };
      })
      .filter(Boolean)
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  }

  formatChartValue(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  renderChartView() {
    const points = this.computeChartPoints(this.getVisibleGroups());

    this.chartEl.innerHTML = '';
    const hasAnyHistory = this.groups.length > 0;
    const hasPoints = points.length > 0;

    this.emptyStateEl.hidden = hasPoints;
    this.chartEl.hidden = !hasPoints;

    if (!hasPoints) {
      this.emptyTitleEl.textContent = hasAnyHistory ? t('workout.historyNoResultsForFilter') : t('workout.historyEmpty');
      return;
    }

    this.chartEl.appendChild(this.buildChart(points));
  }

  buildChart(points) {
    const wrap = document.createElement('div');
    wrap.className = 'exercise-chart-wrap';

    const caption = document.createElement('p');
    caption.className = 'exercise-chart-caption';
    const last = points[points.length - 1];
    caption.textContent = `${last.date}: ${this.formatChartValue(last.value)}`;
    wrap.appendChild(caption);

    const svg = window.WorkoutCharts.buildLineChartSvg(points, {
      formatValue: (v) => this.formatChartValue(v),
      onSelect: (p) => {
        caption.textContent = `${p.date}: ${this.formatChartValue(p.value)}`;
      },
    });
    wrap.appendChild(svg);
    return wrap;
  }
}

// These overlays (#exercise-picker, #note-editor, #rir-picker, #rpe-picker,
// #gym-picker, #pr-dialog, #exercise-history-screen) are singleton elements
// in the page — there's only one of each in the DOM. ActiveWorkoutController
// and WorkoutDetailController must share the same controller instances
// rather than each constructing their own: two instances both binding click
// handlers to the same shared buttons means whichever was constructed last
// "wins" (its handlers are the ones left on the DOM), silently breaking the
// other screen's picker/editor.
const sharedExercisePicker = new ExercisePickerController();
const sharedNoteEditor = new NoteEditorController();
const sharedRirPicker = new RirPickerController();
const sharedRpePicker = new RpePickerController();
const sharedGymPicker = new GymPickerController();
const sharedPRDialog = new PRDialogController();
const sharedExerciseHistory = new ExerciseHistoryController();

window.WorkoutExerciseHistory = {
  open: (exerciseId, opts) => sharedExerciseHistory.open(exerciseId, opts),
};

// -- Active Workout controller --------------------------------------------

class ActiveWorkoutController {
  constructor() {
    this.overlay = document.getElementById('workout-screen');
    this.minimizeBtn = document.getElementById('workout-minimize-btn');
    this.discardBtn = document.getElementById('workout-discard-btn');
    this.elapsedEl = document.getElementById('workout-elapsed');
    this.timerBtn = document.getElementById('workout-timer-btn');
    this.timerDisplay = document.getElementById('workout-timer-display');
    this.timerPanel = document.getElementById('timer-panel');
    this.timerStartBtn = document.getElementById('timer-start-btn');
    this.timerPauseBtn = document.getElementById('timer-pause-btn');
    this.timerResetBtn = document.getElementById('timer-reset-btn');
    this.exerciseRowEl = document.getElementById('workout-exercise-row');
    this.mainEl = document.getElementById('workout-main');
    this.resumeBar = document.getElementById('resume-workout-bar');
    this.resumeBarElapsed = document.getElementById('resume-bar-elapsed');

    this.draft = null;
    this.exerciseCache = new Map(); // exercise_id -> Exercise
    this.previousSetsCache = new Map(); // exercise_id -> WorkoutSet[]
    this.lastNoteCache = new Map(); // exercise_id -> ExerciseNote|null
    this.dismissedNotes = new Set(); // transient, reset each time the screen opens
    this.dismissedGlobalNotes = new Set(); // transient, reset each time the screen opens

    this.elapsedInterval = null;
    this.countdownInterval = null;
    this.resumeBarInterval = null;
    this.resumeBarDraft = null;

    this.picker = sharedExercisePicker;
    this.noteEditor = sharedNoteEditor;
    this.rirPicker = sharedRirPicker;
    this.rpePicker = sharedRpePicker;
    this.gymPicker = sharedGymPicker;
    this.gymsCache = new Map(); // gym_id -> Gym, refreshed each time the screen opens
    this.prDialog = sharedPRDialog;
    this.exerciseHistory = sharedExerciseHistory;

    this.wireStaticEvents();
  }

  isOpen() {
    return !this.overlay.hidden;
  }

  wireStaticEvents() {
    this.minimizeBtn.addEventListener('click', () => this.closeScreen());
    this.discardBtn.addEventListener('click', () => this.handleDiscardWorkout());

    // The exercise row's scrollbar is hidden for a cleaner look, and there's
    // no touch swipe on desktop, so translate a normal (vertical) mouse
    // wheel scroll into horizontal scrolling while hovering the row.
    this.exerciseRowEl.addEventListener(
      'wheel',
      (e) => {
        if (e.deltaY === 0) return;
        if (this.exerciseRowEl.scrollWidth <= this.exerciseRowEl.clientWidth) return;
        e.preventDefault();
        this.exerciseRowEl.scrollLeft += e.deltaY;
      },
      { passive: false }
    );

    this.timerBtn.addEventListener('click', () => {
      this.timerPanel.hidden = !this.timerPanel.hidden;
    });
    this.timerStartBtn.addEventListener('click', () => this.startCountdown());
    this.timerPauseBtn.addEventListener('click', () => this.pauseCountdown());
    this.timerResetBtn.addEventListener('click', () => this.resetCountdown());
    this.timerPanel.querySelectorAll('.timer-presets button').forEach((btn) => {
      btn.addEventListener('click', () => this.addCountdownSeconds(Number(btn.dataset.seconds)));
    });
    this.resumeBar.addEventListener('click', () => this.openExisting());

    window.addEventListener('app:languagechange', () => {
      if (this.isOpen()) {
        // The tab strip holds the "Finish Workout" button, so it needs
        // redrawing too, not just the main area.
        this.renderExerciseRow();
        this.renderMain();
      }
      this.refreshResumeBar();
    });
    window.addEventListener('app:exercisedeleted', (e) => this.handleExerciseDeleted(e.detail.exerciseId));
  }

  // -- Draft lifecycle ----------------------------------------------------

  async startOrResume() {
    const existing = await window.WorkoutRepo.getDraft();
    if (existing) {
      await this.openExisting();
      return;
    }
    const now = new Date();
    this.draft = {
      name: t('workout.defaultName'),
      date: todayDateKey(),
      startedAt: now.toISOString(),
      exercises: [],
      activeExerciseId: null,
      sets: [],
      exerciseNotes: {},
      gymByExercise: {},
      countdown: { remainingSeconds: 0, running: false, targetEndAt: null },
    };
    await this.persistDraft();
    this.dismissedNotes.clear();
    this.dismissedGlobalNotes.clear();
    await this.openScreen();
  }

  async openExisting() {
    const draft = await window.WorkoutRepo.getDraft();
    if (!draft) return;
    draft.gymByExercise = draft.gymByExercise ?? {}; // old drafts predate per-exercise gym tracking
    this.draft = draft;
    this.dismissedNotes.clear();
    this.dismissedGlobalNotes.clear();
    await this.openScreen();
  }

  async persistDraft() {
    if (!this.draft) return;
    await window.WorkoutRepo.saveDraft(this.draft);
    this.refreshResumeBar();
  }

  async openScreen() {
    this.overlay.hidden = false;
    this.exerciseCache.clear();
    this.previousSetsCache.clear();
    this.lastNoteCache.clear();
    await this.loadGyms();
    this.startElapsedTicker();
    this.startCountdownTicker();
    this.updateTimerButtonDisplay();
    await this.render();
    this.refreshResumeBar();
  }

  closeScreen() {
    this.overlay.hidden = true;
    this.stopElapsedTicker();
    this.stopCountdownTicker();
    this.refreshResumeBar();
  }

  // -- Top bar: elapsed time -----------------------------------------------

  startElapsedTicker() {
    this.stopElapsedTicker();
    this.tickElapsed();
    this.elapsedInterval = setInterval(() => this.tickElapsed(), 1000);
  }

  stopElapsedTicker() {
    if (this.elapsedInterval) clearInterval(this.elapsedInterval);
    this.elapsedInterval = null;
  }

  tickElapsed() {
    if (!this.draft) return;
    const ms = Date.now() - new Date(this.draft.startedAt).getTime();
    this.elapsedEl.textContent = formatElapsed(ms);
  }

  // -- Top bar: manual countdown timer -------------------------------------

  startCountdown() {
    const c = this.draft.countdown;
    if (c.remainingSeconds <= 0 || c.running) return;
    c.running = true;
    c.targetEndAt = Date.now() + c.remainingSeconds * 1000;
    this.persistDraft();
    this.updateTimerButtonDisplay();
  }

  pauseCountdown() {
    const c = this.draft.countdown;
    if (!c.running) return;
    c.remainingSeconds = Math.max(0, Math.round((c.targetEndAt - Date.now()) / 1000));
    c.running = false;
    c.targetEndAt = null;
    this.persistDraft();
    this.updateTimerButtonDisplay();
  }

  resetCountdown() {
    const c = this.draft.countdown;
    c.remainingSeconds = 0;
    c.running = false;
    c.targetEndAt = null;
    this.persistDraft();
    this.updateTimerButtonDisplay();
  }

  addCountdownSeconds(seconds) {
    const c = this.draft.countdown;
    if (c.running) {
      c.targetEndAt += seconds * 1000;
    } else {
      c.remainingSeconds += seconds;
    }
    this.persistDraft();
    this.updateTimerButtonDisplay();
  }

  startCountdownTicker() {
    this.stopCountdownTicker();
    this.countdownInterval = setInterval(() => this.tickCountdown(), 1000);
  }

  stopCountdownTicker() {
    if (this.countdownInterval) clearInterval(this.countdownInterval);
    this.countdownInterval = null;
  }

  tickCountdown() {
    if (!this.draft) return;
    const c = this.draft.countdown;
    if (c.running) {
      const remaining = Math.round((c.targetEndAt - Date.now()) / 1000);
      if (remaining <= 0) {
        c.running = false;
        c.targetEndAt = null;
        c.remainingSeconds = 0;
        this.persistDraft();
        playBeep();
      }
    }
    this.updateTimerButtonDisplay();
  }

  updateTimerButtonDisplay() {
    if (!this.draft) return;
    const c = this.draft.countdown;
    const remaining = c.running ? Math.max(0, Math.round((c.targetEndAt - Date.now()) / 1000)) : c.remainingSeconds;
    this.timerDisplay.textContent = c.running || c.remainingSeconds > 0 ? formatCountdown(remaining) : '--:--';
    this.timerBtn.classList.toggle('is-running', c.running);
    this.timerStartBtn.hidden = c.running;
    this.timerPauseBtn.hidden = !c.running;
  }

  // -- Exercise row ----------------------------------------------------------

  renderExerciseRow() {
    this.exerciseRowEl.innerHTML = '';
    this.draft.exercises.forEach((exerciseId) => {
      const exercise = this.exerciseCache.get(exerciseId);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'exercise-row-item';
      if (exerciseId === this.draft.activeExerciseId) btn.classList.add('is-active');
      // A cached null means "looked up, doesn't exist" (deleted) — distinct
      // from "not loaded yet", which is the only case '…' is meant for.
      btn.textContent = exercise
        ? exercise.name
        : this.exerciseCache.has(exerciseId)
          ? t('workout.deletedExercise')
          : '…';
      btn.addEventListener('click', () => this.setActiveExercise(exerciseId));
      this.exerciseRowEl.appendChild(btn);
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'exercise-row-add';
    addBtn.textContent = '+';
    addBtn.setAttribute('aria-label', 'Add exercise');
    addBtn.addEventListener('click', () => this.handleAddExercise());
    this.exerciseRowEl.appendChild(addBtn);

    const finishBtn = document.createElement('button');
    finishBtn.type = 'button';
    finishBtn.className = 'exercise-row-finish';
    finishBtn.textContent = t('workout.finishWorkout');
    finishBtn.addEventListener('click', () => this.handleFinishWorkout());
    this.exerciseRowEl.appendChild(finishBtn);
  }

  async setActiveExercise(exerciseId) {
    this.draft.activeExerciseId = exerciseId;
    await this.persistDraft();
    await this.render();
  }

  async handleAddExercise() {
    await this.picker.open({
      excludeIds: this.draft.exercises,
      titleKey: 'workout.pickExerciseTitleAdd',
      onPick: async (exerciseId) => {
        this.draft.exercises.push(exerciseId);
        this.draft.activeExerciseId = exerciseId;
        await this.loadExercise(exerciseId);
        await this.persistDraft();
        await this.render();
      },
    });
  }

  async handleSwap(exerciseId) {
    const hasDataToLose =
      this.draft.sets.some((s) => s.exercise_id === exerciseId) || !!this.draft.exerciseNotes[exerciseId];

    await this.picker.open({
      excludeIds: this.draft.exercises,
      titleKey: 'workout.pickExerciseTitleSwap',
      onPick: async (newExerciseId) => {
        if (hasDataToLose) {
          const confirmed = await showConfirm({
            title: t('workout.confirmSwapTitle'),
            message: t('workout.confirmSwapMessage'),
            confirmText: t('workout.swap'),
          });
          if (!confirmed) return;
        }

        const idx = this.draft.exercises.indexOf(exerciseId);
        if (idx !== -1) this.draft.exercises[idx] = newExerciseId;
        this.draft.sets = this.draft.sets.filter((s) => s.exercise_id !== exerciseId);
        delete this.draft.exerciseNotes[exerciseId];
        if (this.draft.activeExerciseId === exerciseId) this.draft.activeExerciseId = newExerciseId;
        await this.loadExercise(newExerciseId);
        await this.persistDraft();
        await this.render();
      },
    });
  }

  // -- Data loading ------------------------------------------------------

  async loadExercise(exerciseId) {
    if (this.exerciseCache.has(exerciseId)) return this.exerciseCache.get(exerciseId);
    const exercise = await window.WorkoutRepo.getExercise(exerciseId);
    this.exerciseCache.set(exerciseId, exercise);
    return exercise;
  }

  async loadPreviousSets(exerciseId, gymId) {
    const cacheKey = `${exerciseId}::${gymId}`;
    if (this.previousSetsCache.has(cacheKey)) return this.previousSetsCache.get(cacheKey);
    const sets = await window.WorkoutRepo.getLastLoggedSetsForExercise(exerciseId, gymId);
    this.previousSetsCache.set(cacheKey, sets);
    return sets;
  }

  async loadLastNote(exerciseId) {
    if (this.lastNoteCache.has(exerciseId)) return this.lastNoteCache.get(exerciseId);
    const note = await window.WorkoutRepo.getMostRecentExerciseNoteForExercise(exerciseId);
    this.lastNoteCache.set(exerciseId, note);
    return note;
  }

  // -- Gym selection (per exercise, within this workout) -------------------

  async loadGyms() {
    const gyms = await window.WorkoutRepo.getAllGyms();
    this.gymsCache = new Map(gyms.map((g) => [g.id, g]));
  }

  getExerciseGym(exerciseId) {
    return this.draft.gymByExercise[exerciseId] ?? GENERAL_GYM_ID;
  }

  gymName(gymId) {
    if (gymId === GENERAL_GYM_ID) return t('gyms.general');
    return this.gymsCache.get(gymId)?.name ?? t('gyms.general');
  }

  handleSetGym(exerciseId) {
    this.gymPicker.open(this.getExerciseGym(exerciseId), async (gymId) => {
      this.draft.gymByExercise[exerciseId] = gymId;
      // Every set of this exercise moves to the new gym, not just ones
      // added afterwards — same as the past-workout editor.
      this.draft.sets.filter((s) => s.exercise_id === exerciseId).forEach((s) => {
        s.gym_id = gymId;
      });
      await this.persistDraft();
      await this.renderMain();
    });
  }

  // -- Main render ---------------------------------------------------------

  async render() {
    await Promise.all(this.draft.exercises.map((id) => this.loadExercise(id)));
    this.renderExerciseRow();
    await this.renderMain();
  }

  async renderMain() {
    this.mainEl.innerHTML = '';

    if (this.draft.exercises.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-state-subtitle';
      empty.style.textAlign = 'center';
      empty.style.marginTop = '48px';
      empty.textContent = t('workout.noExercisesYet');
      this.mainEl.appendChild(empty);
      return;
    }

    const exerciseId = this.draft.activeExerciseId ?? this.draft.exercises[0];
    if (exerciseId !== this.draft.activeExerciseId) {
      this.draft.activeExerciseId = exerciseId;
      this.persistDraft();
    }

    const exercise = await this.loadExercise(exerciseId);
    if (!exercise) {
      this.mainEl.appendChild(buildDeletedExercisePanel(() => this.handleRemoveExercise(exerciseId)));
      return;
    }

    const gymId = this.getExerciseGym(exerciseId);
    const previousSets = await this.loadPreviousSets(exerciseId, gymId);
    const mySets = this.draft.sets.filter((s) => s.exercise_id === exerciseId);

    this.mainEl.appendChild(this.buildHeading(exercise));
    this.mainEl.appendChild(this.buildStatusLine(mySets));

    const globalNoteEl = this.buildGlobalNoteBox(exercise, exerciseId);
    if (globalNoteEl) this.mainEl.appendChild(globalNoteEl);

    const noteEl = await this.buildNoteBox(exerciseId);
    if (noteEl) this.mainEl.appendChild(noteEl);

    this.mainEl.appendChild(this.buildActionRow(exercise, exerciseId));
    this.mainEl.appendChild(this.buildSetTable(exercise, mySets, previousSets));
  }

  buildHeading(exercise) {
    const h = document.createElement('h2');
    h.className = 'workout-exercise-name';
    h.textContent = exercise.name;
    return h;
  }

  buildStatusLine(mySets) {
    const p = document.createElement('p');
    p.className = 'workout-set-status';

    const ordered = mySets
      .slice()
      .sort((a, b) => {
        if (a.is_warmup_set !== b.is_warmup_set) return a.is_warmup_set ? -1 : 1;
        return a.set_number - b.set_number;
      });
    const nextUndone = ordered.find((s) => !s.done);
    const workingSets = mySets.filter((s) => !s.is_warmup_set);

    if (nextUndone && nextUndone.is_warmup_set) {
      p.textContent = t('workout.warmupLabel');
    } else if (workingSets.length > 0) {
      const current = nextUndone ? nextUndone.set_number : workingSets.length;
      p.textContent = t('workout.setOfY', { x: current, y: workingSets.length });
    } else {
      p.textContent = '';
    }
    return p;
  }

  /** The exercise's permanent, general-purpose note (Exercise.notes, set from
   * the Create/Edit Exercise screen). Always shown when present — unlike the
   * per-workout carry-forward note below, this isn't dismissible, since it's
   * a stable property of the exercise itself, not a one-off session note. */
  buildGlobalNoteBox(exercise, exerciseId) {
    if (this.dismissedGlobalNotes.has(exerciseId)) return null;
    if (!exercise.notes || !exercise.notes.trim()) return null;

    const box = document.createElement('div');
    box.className = 'workout-note-box workout-global-note-box';

    const icon = document.createElement('span');
    icon.className = 'workout-note-icon';
    icon.innerHTML =
      '<svg viewBox="0 0 24 24" width="15" height="15"><path d="M4 4h16v12H8l-4 4V4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    const text = document.createElement('span');
    text.className = 'workout-note-text';
    text.textContent = exercise.notes;

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'workout-note-dismiss';
    dismiss.setAttribute('aria-label', t('workout.dismissNote'));
    dismiss.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    dismiss.addEventListener('click', () => {
      this.dismissedGlobalNotes.add(exerciseId);
      this.renderMain();
    });

    box.append(icon, text, dismiss);
    return box;
  }

  async buildNoteBox(exerciseId) {
    if (this.dismissedNotes.has(exerciseId)) return null;
    const note = await this.loadLastNote(exerciseId);
    if (!note || !note.text) return null;

    const box = document.createElement('div');
    box.className = 'workout-note-box';

    const text = document.createElement('span');
    text.className = 'workout-note-text';
    text.textContent = note.text;

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'workout-note-dismiss';
    dismiss.setAttribute('aria-label', t('workout.dismissNote'));
    dismiss.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    dismiss.addEventListener('click', () => {
      this.dismissedNotes.add(exerciseId);
      this.renderMain();
    });

    box.append(text, dismiss);
    return box;
  }

  buildActionRow(exercise, exerciseId) {
    const row = document.createElement('div');
    row.className = 'workout-action-row workout-action-row-wide';

    const addSetBtn = document.createElement('button');
    addSetBtn.type = 'button';
    addSetBtn.className = 'workout-action-btn';
    addSetBtn.textContent = t('workout.addSet');
    addSetBtn.addEventListener('click', () => this.addSet(exerciseId, false));

    const addWarmupBtn = document.createElement('button');
    addWarmupBtn.type = 'button';
    addWarmupBtn.className = 'workout-action-btn';
    addWarmupBtn.textContent = t('workout.addWarmup');
    addWarmupBtn.addEventListener('click', () => this.addSet(exerciseId, true));

    const swapBtn = document.createElement('button');
    swapBtn.type = 'button';
    swapBtn.className = 'workout-action-btn';
    swapBtn.textContent = t('workout.swap');
    swapBtn.addEventListener('click', () => this.handleSwap(exerciseId));

    const noteBtn = document.createElement('button');
    noteBtn.type = 'button';
    noteBtn.className = 'workout-action-btn';
    noteBtn.textContent = t('workout.note');
    noteBtn.addEventListener('click', () => this.handleWriteNote(exerciseId));

    const gymBtn = document.createElement('button');
    gymBtn.type = 'button';
    gymBtn.className = 'workout-action-btn';
    gymBtn.textContent = `${t('workout.gym')}: ${this.gymName(this.getExerciseGym(exerciseId))}`;
    gymBtn.addEventListener('click', () => this.handleSetGym(exerciseId));

    const prBtn = document.createElement('button');
    prBtn.type = 'button';
    prBtn.className = 'workout-action-btn';
    prBtn.textContent = t('workout.prButton');
    prBtn.addEventListener('click', () => this.handleOpenPR(exerciseId));

    const historyBtn = document.createElement('button');
    historyBtn.type = 'button';
    historyBtn.className = 'workout-action-btn';
    historyBtn.textContent = t('workout.historyButton');
    historyBtn.addEventListener('click', () => this.handleOpenHistory(exerciseId));

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'workout-action-btn';
    editBtn.textContent = t('workout.editExercise');
    editBtn.addEventListener('click', () => this.handleEditExercise(exerciseId));

    const idx = this.draft.exercises.indexOf(exerciseId);

    const moveLeftBtn = document.createElement('button');
    moveLeftBtn.type = 'button';
    moveLeftBtn.className = 'workout-action-btn workout-action-btn-icon';
    moveLeftBtn.setAttribute('aria-label', t('workout.moveLeft'));
    moveLeftBtn.disabled = idx <= 0;
    moveLeftBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    moveLeftBtn.addEventListener('click', () => this.moveExercise(exerciseId, -1));

    const moveRightBtn = document.createElement('button');
    moveRightBtn.type = 'button';
    moveRightBtn.className = 'workout-action-btn workout-action-btn-icon';
    moveRightBtn.setAttribute('aria-label', t('workout.moveRight'));
    moveRightBtn.disabled = idx === -1 || idx >= this.draft.exercises.length - 1;
    moveRightBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    moveRightBtn.addEventListener('click', () => this.moveExercise(exerciseId, 1));

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'workout-action-btn workout-action-btn-danger';
    removeBtn.textContent = t('workout.remove');
    removeBtn.addEventListener('click', () => this.handleRemoveExercise(exerciseId));

    const favoriteBtn = document.createElement('button');
    favoriteBtn.type = 'button';
    favoriteBtn.className = 'workout-action-btn workout-action-btn-icon';
    favoriteBtn.classList.toggle('is-favorite', !!exercise.isFavorite);
    favoriteBtn.setAttribute('aria-pressed', String(!!exercise.isFavorite));
    favoriteBtn.setAttribute('aria-label', t('exercise.favoriteToggle'));
    favoriteBtn.innerHTML = window.WorkoutIcons.starIconSvg(!!exercise.isFavorite);
    favoriteBtn.addEventListener('click', () => this.handleToggleFavorite(exerciseId));

    row.append(
      addSetBtn,
      addWarmupBtn,
      historyBtn,
      prBtn,
      noteBtn,
      editBtn,
      swapBtn,
      removeBtn,
      gymBtn,
      moveLeftBtn,
      moveRightBtn,
      favoriteBtn
    );
    return row;
  }

  async handleToggleFavorite(exerciseId) {
    const updated = await window.WorkoutRepo.toggleExerciseFavorite(exerciseId);
    if (!updated) return;
    this.exerciseCache.set(exerciseId, updated);
    await this.renderMain();
  }

  /** Opens the same shared Create/Edit Exercise screen used from the
   * Exercises tab. Editing here only ever changes the Exercise record
   * itself (name/muscle groups/metric/effort tracking/notes) — it never
   * touches any WorkoutSet already logged, so nothing about past sets is
   * rewritten. this.exerciseCache is keyed by exerciseId and would
   * otherwise keep serving the pre-edit copy for the rest of this session. */
  async handleEditExercise(exerciseId) {
    const exercise = await this.loadExercise(exerciseId);
    const editor = window.WorkoutExercisesFeature.editor;
    if (!exercise || !editor) return;
    editor.open(exercise, {
      onClose: async () => {
        this.exerciseCache.delete(exerciseId);
        // renderExerciseRow() reads names synchronously out of
        // exerciseCache (no fetch of its own) — call it before this
        // reloads the just-deleted entry and it has nothing to show but
        // the '…' placeholder, which then never gets corrected since
        // nothing else re-renders the tab strip afterward. Reload first.
        await this.loadExercise(exerciseId);
        this.renderExerciseRow();
        await this.renderMain();
      },
    });
  }

  async handleOpenPR(exerciseId) {
    const exercise = await this.loadExercise(exerciseId);
    const gymId = this.getExerciseGym(exerciseId);
    await this.prDialog.open({
      exercise,
      exerciseId,
      gymId,
      gymName: this.gymName(gymId),
      getCurrentSets: () => this.draft.sets.filter((s) => s.exercise_id === exerciseId),
    });
  }

  async handleOpenHistory(exerciseId) {
    const gymId = this.getExerciseGym(exerciseId);
    await this.exerciseHistory.open(exerciseId, { initialGymId: gymId });
  }

  async moveExercise(exerciseId, direction) {
    const idx = this.draft.exercises.indexOf(exerciseId);
    if (idx === -1) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= this.draft.exercises.length) return;

    [this.draft.exercises[idx], this.draft.exercises[newIdx]] = [
      this.draft.exercises[newIdx],
      this.draft.exercises[idx],
    ];
    await this.persistDraft();
    await this.render();
  }

  async handleRemoveExercise(exerciseId) {
    // Only ask when there's something to lose: a set ticked done, or a note.
    const hasLogged =
      this.draft.sets.some((s) => s.exercise_id === exerciseId && s.done) ||
      !!(this.draft.exerciseNotes[exerciseId] ?? '').trim();
    if (hasLogged) {
      const confirmed = await showConfirm({
        title: t('workout.confirmRemoveTitle'),
        message: t('workout.confirmRemoveMessage'),
        confirmText: t('workout.remove'),
      });
      if (!confirmed) return;
    }

    removeExerciseFromDraft(this.draft, exerciseId);
    await this.persistDraft();
    await this.render();
  }

  /** The exercise was deleted from the library (Exercises tab, or Edit →
   * Delete inside this workout). The repository already cleaned up stored
   * history; this drops it from the draft, which may only exist on disk if
   * the workout hasn't been opened since the app loaded. */
  async handleExerciseDeleted(exerciseId) {
    this.exerciseCache.delete(exerciseId);
    if (this.draft) {
      if (!this.draft.exercises.includes(exerciseId)) return;
      removeExerciseFromDraft(this.draft, exerciseId);
      await this.persistDraft();
      if (this.isOpen()) await this.render();
      return;
    }
    const draft = await window.WorkoutRepo.getDraft();
    if (!draft || !(draft.exercises ?? []).includes(exerciseId)) return;
    removeExerciseFromDraft(draft, exerciseId);
    await window.WorkoutRepo.saveDraft(draft);
  }

  async addSet(exerciseId, isWarmup) {
    const count = this.draft.sets.filter((s) => s.exercise_id === exerciseId && s.is_warmup_set === isWarmup).length;
    const setNumber = count + 1;
    const gymId = this.getExerciseGym(exerciseId);
    const exercise = await this.loadExercise(exerciseId);
    const previousSets = await this.loadPreviousSets(exerciseId, gymId);
    const autoFill = window.WorkoutAutoFill.computeAutoFillValues(exercise, previousSets, setNumber, isWarmup);

    this.draft.sets.push({
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
      gym_id: gymId,
    });
    await this.persistDraft();
    await this.renderMain();
  }

  /** Deletes one set row, then renumbers the remaining sets in its
   * warmup/working group so set numbers stay contiguous (1, 2, 3...). */
  async deleteSet(exerciseId, draftSetId) {
    const removed = this.draft.sets.find((s) => s.draft_set_id === draftSetId);
    if (!removed) return;

    // Only a set ticked done counts as logged; an untouched or
    // auto-filled row goes without asking.
    if (removed.done) {
      const confirmed = await showConfirm({
        title: t('workout.confirmDeleteSetTitle'),
        message: t('workout.confirmDeleteSetMessage'),
        confirmText: t('workout.deleteSet'),
      });
      if (!confirmed) return;
    }

    this.draft.sets = this.draft.sets.filter((s) => s.draft_set_id !== draftSetId);

    const group = this.draft.sets
      .filter((s) => s.exercise_id === exerciseId && s.is_warmup_set === removed.is_warmup_set)
      .sort((a, b) => a.set_number - b.set_number);
    group.forEach((s, index) => {
      s.set_number = index + 1;
    });

    await this.persistDraft();
    await this.renderMain();
  }

  async handleWriteNote(exerciseId) {
    const initialText = this.draft.exerciseNotes[exerciseId] ?? '';
    const exercise = await this.loadExercise(exerciseId);
    const lastNote = await this.loadLastNote(exerciseId);
    this.noteEditor.open({
      initialText,
      globalNoteText: exercise?.notes ?? '',
      previousNoteText: lastNote?.text ?? '',
      onSave: async (text) => {
        if (text && text.trim()) {
          this.draft.exerciseNotes[exerciseId] = text;
        } else {
          delete this.draft.exerciseNotes[exerciseId];
        }
        await this.persistDraft();
      },
    });
  }

  buildSetTable(exercise, mySets, previousSets) {
    const metric = exercise.metric;
    // Input 1 is always the metric's type value (e.g. reps). Input 2 is the
    // metric's unit value (e.g. kg) and only appears when a unit is set.
    const showInput2 = !!metric && !!metric.unit && metric.unit !== 'none';
    const showEffort = exercise.effortTracking !== 'none';
    // 'reps_per_side' splits Input 1 into two independent boxes (Left/Right)
    // instead of one, since each side is usually a different number.
    const isPerSide = metric?.type === 'reps_per_side';

    const table = document.createElement('table');
    table.className = 'set-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headRow.appendChild(this.th(t('workout.tableSet')));
    headRow.appendChild(this.th(t('workout.tablePrevious')));
    if (isPerSide) {
      headRow.appendChild(this.th(t('workout.sideLeft')));
      headRow.appendChild(this.th(t('workout.sideRight')));
    } else {
      headRow.appendChild(this.th(metricTypeColumnLabel(metric)));
    }
    if (showInput2) headRow.appendChild(this.th(metricUnitColumnLabel(metric)));
    if (showEffort) headRow.appendChild(this.th(exercise.effortTracking === 'rir' ? 'RIR' : 'RPE'));
    headRow.appendChild(this.th(t('workout.tableDone')));
    headRow.appendChild(this.th(''));
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const ordered = mySets.slice().sort((a, b) => {
      if (a.is_warmup_set !== b.is_warmup_set) return a.is_warmup_set ? -1 : 1;
      return a.set_number - b.set_number;
    });

    ordered.forEach((set) => {
      const tr = document.createElement('tr');
      if (set.is_warmup_set) tr.classList.add('is-warmup');
      if (set.done) tr.classList.add('is-done');

      const label = document.createElement('td');
      label.className = 'set-cell-label';
      label.textContent = `${set.is_warmup_set ? 'W' : ''}${set.set_number}`;
      tr.appendChild(label);

      const prevMatch = previousSets.find(
        (p) => p.is_warmup_set === set.is_warmup_set && p.set_number === set.set_number
      );
      const prevCell = document.createElement('td');
      prevCell.className = 'set-cell-previous';
      prevCell.textContent = prevMatch ? formatSetSummary(exercise, prevMatch) : '—';
      tr.appendChild(prevCell);

      if (isPerSide) {
        tr.appendChild(this.inputCell(set, 'input_1', 'natural', ''));
        tr.appendChild(this.inputCell(set, 'input_1_right', 'natural', ''));
      } else {
        const input1Format = INPUT_FORMAT_BY_TYPE[metric?.type] ?? null;
        const input1Placeholder = metric?.type === 'min_sec' ? 'mm:ss' : metric?.type === 'hr_min' ? 'hh:mm' : '';
        tr.appendChild(this.inputCell(set, 'input_1', input1Format, input1Placeholder));
      }
      if (showInput2) {
        tr.appendChild(this.inputCell(set, 'input_2', INPUT_FORMAT_BY_UNIT[metric.unit] ?? null, ''));
      }
      if (showEffort) {
        const isRir = exercise.effortTracking === 'rir';
        tr.appendChild(isRir ? this.buildRirCell(set) : this.buildRpeCell(set));
      }

      const doneCell = document.createElement('td');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'set-done-checkbox';
      checkbox.checked = !!set.done;
      checkbox.addEventListener('change', async () => {
        // A set can't be logged with nothing in it — it would be saved as a
        // real set, counted in stats, and used as "last time" for auto-fill.
        if (checkbox.checked && !setHasRequiredValues(exercise, set)) {
          checkbox.checked = false;
          tr.querySelectorAll('input.set-input').forEach((input) => {
            if (input.value.trim() !== '') return;
            input.classList.remove('set-input-error');
            void input.offsetWidth; // restart the animation on repeat taps
            input.classList.add('set-input-error');
          });
          return;
        }
        set.done = checkbox.checked;
        await this.persistDraft();
        await this.renderMain();
      });
      doneCell.appendChild(checkbox);
      tr.appendChild(doneCell);

      const deleteCell = document.createElement('td');
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'set-delete-btn';
      deleteBtn.setAttribute('aria-label', t('workout.deleteSet'));
      deleteBtn.innerHTML =
        '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      deleteBtn.addEventListener('click', () => this.deleteSet(exercise.id, set.draft_set_id));
      deleteCell.appendChild(deleteBtn);
      tr.appendChild(deleteCell);

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);

    const wrap = document.createElement('div');
    wrap.className = 'set-table-wrap';
    wrap.appendChild(table);
    return wrap;
  }

  th(text) {
    const el = document.createElement('th');
    el.textContent = text;
    return el;
  }

  inputCell(set, field, format = null, placeholder = '') {
    const td = document.createElement('td');
    const input = document.createElement('input');
    input.className = 'set-input';
    input.type = 'text';
    input.inputMode = format === 'rational' ? 'decimal' : 'numeric';
    if (placeholder) input.placeholder = placeholder;
    input.value = set[field] ?? '';
    // Format/validate on commit (blur or Enter) only, not on every keystroke:
    // rewriting .value mid-typing fights mobile virtual keyboards (backspace
    // can end up deleting more than intended, or the field can get stuck).
    input.addEventListener('change', async () => {
      const raw = format ? sanitizeInputValue(input.value.trim(), format) : input.value.trim();
      input.value = raw;
      set[field] = raw === '' ? null : raw;
      await this.persistDraft();
    });
    td.appendChild(input);
    return td;
  }

  /** RIR's cell: a button (not a free-text field) that opens the color-coded
   * 0-6+ picker, and shows the current value tinted with its scale color. */
  buildRirCell(set) {
    const td = document.createElement('td');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'set-input';
    btn.textContent = set.rir ?? '';
    if (set.rir != null && RIR_COLORS[set.rir] != null) {
      btn.style.background = RIR_COLORS[set.rir];
      btn.style.color = '#fff';
      btn.style.fontWeight = '700';
    }
    btn.addEventListener('click', () => {
      this.rirPicker.open(async (value) => {
        set.rir = value === '' ? null : value;
        await this.persistDraft();
        await this.renderMain();
      });
    });
    td.appendChild(btn);
    return td;
  }

  /** RPE's cell: same pattern as buildRirCell, but the color-coded 1-10
   * picker (blue/easy through red/max effort). */
  buildRpeCell(set) {
    const td = document.createElement('td');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'set-input';
    btn.textContent = set.rpe ?? '';
    if (set.rpe != null && RPE_COLORS[set.rpe] != null) {
      btn.style.background = RPE_COLORS[set.rpe];
      btn.style.color = '#fff';
      btn.style.fontWeight = '700';
    }
    btn.addEventListener('click', () => {
      this.rpePicker.open(async (value) => {
        set.rpe = value === '' ? null : value;
        await this.persistDraft();
        await this.renderMain();
      });
    });
    td.appendChild(btn);
    return td;
  }

  // -- Finish workout flow --------------------------------------------------

  async handleFinishWorkout() {
    // Only sets ticked done are saved, so with none there'd be nothing but
    // an empty workout (and a calendar dot) to show for it. Offer to discard
    // instead of asking for a name and date first.
    if (!this.draft.sets.some((s) => s.done)) {
      const discard = await showConfirm({
        title: t('workout.nothingToSaveTitle'),
        message: t('workout.nothingToSaveMessage'),
        confirmText: t('workout.discardButton'),
        cancelText: t('workout.keepEditing'),
      });
      if (discard) await this.discardDraft();
      return;
    }

    const choice = await showFinishDialog({
      defaultName: this.draft.name,
      defaultDate: this.draft.date || todayDateKey(),
    });
    if (!choice) return;

    const hasIncomplete = this.draft.sets.some((s) => !s.done);
    if (hasIncomplete) {
      const proceed = await showConfirm({
        title: t('workout.confirmIncompleteTitle'),
        message: t('workout.confirmIncompleteMessage'),
      });
      if (!proceed) return;
    }

    this.draft.name = choice.name;
    this.draft.date = choice.date;
    await window.WorkoutRepo.finishDraftWorkout(this.draft);
    this.draft = null;
    this.closeScreen();
    if (this.onFinished) this.onFinished();

    // A service worker update that arrived (periodic re-check or otherwise)
    // while this workout was active gets held back — see sw.js/updates.js's
    // maybeActivateWaiting — deliberately so it never interrupts an
    // in-progress workout. Now that the draft is gone, nudge it immediately
    // rather than leaving it stuck waiting for the next scheduled check
    // (up to ~20 minutes later) to happen to notice. No-op if nothing's
    // actually waiting.
    window.WorkoutUpdates.maybeActivateWaiting();
  }

  async handleDiscardWorkout() {
    const confirmed = await showConfirm({
      title: t('workout.confirmDiscardTitle'),
      message: t('workout.confirmDiscardMessage'),
      confirmText: t('workout.discardButton'),
    });
    if (!confirmed) return;
    await this.discardDraft();
  }

  async discardDraft() {
    await window.WorkoutRepo.deleteDraft();
    this.draft = null;
    this.closeScreen();
    if (this.onFinished) this.onFinished();

    // Same reasoning as handleFinishWorkout above.
    window.WorkoutUpdates.maybeActivateWaiting();
  }

  // -- 24h expiry check ------------------------------------------------------

  async checkExpiryOnLoad() {
    const draft = await window.WorkoutRepo.getDraft();
    if (!draft) return;
    const age = Date.now() - new Date(draft.startedAt).getTime();
    if (age < DAY_MS) return;

    // Queued (not just a bare showConfirm) so this can never overlap with
    // the backup reminder or the update "what's new" popup — see
    // runExclusive's comment above for why that matters even though this
    // particular call is already the first thing app.js awaits.
    const save = await runExclusive(() =>
      showConfirm({
        title: t('workout.expiredTitle'),
        message: t('workout.expiredMessage'),
        confirmText: t('common.yes'),
        cancelText: t('common.no'),
      })
    );

    if (save) {
      // Take the user into the normal active-workout screen instead of
      // silently finishing it behind the scenes — they can review what's
      // there and use the regular Finish/Discard flow (which already
      // handles incomplete sets and picking the date), same as any other
      // in-progress workout.
      await this.openExisting();
    } else {
      await window.WorkoutRepo.deleteDraft();
      this.refreshResumeBar();
      // Same reasoning as handleFinishWorkout/handleDiscardWorkout — this
      // is just another path that clears the draft.
      window.WorkoutUpdates.maybeActivateWaiting();
    }
  }

  // -- Resume bar --------------------------------------------------------

  async refreshResumeBar() {
    const draft = this.draft && this.isOpen() ? this.draft : await window.WorkoutRepo.getDraft();
    const shouldShow = !!draft && !this.isOpen();
    this.resumeBar.hidden = !shouldShow;

    if (shouldShow) {
      // The full workout screen's own elapsed ticker (tickElapsed) stops as
      // soon as it's minimized, so without a ticker of its own here the
      // resume bar only ever got a single snapshot — showing whatever time
      // happened to be true at the moment it was minimized, then never
      // advancing until the next full refreshResumeBar() call (previously
      // only the 30s safety-net poll below, which reads as "stuck").
      this.resumeBarDraft = draft;
      this.tickResumeBar();
      if (!this.resumeBarInterval) {
        this.resumeBarInterval = setInterval(() => this.tickResumeBar(), 1000);
      }
    } else if (this.resumeBarInterval) {
      clearInterval(this.resumeBarInterval);
      this.resumeBarInterval = null;
    }
  }

  tickResumeBar() {
    if (!this.resumeBarDraft) return;
    const ms = Date.now() - new Date(this.resumeBarDraft.startedAt).getTime();
    this.resumeBarElapsed.textContent = formatElapsed(ms);
  }
}

let controller = null;

async function init({ onFinished } = {}) {
  controller = new ActiveWorkoutController();
  controller.onFinished = onFinished;
  await controller.checkExpiryOnLoad();
  await controller.refreshResumeBar();
  setInterval(() => controller.refreshResumeBar(), 30000);
}

async function startOrResume() {
  if (!controller) return;
  await controller.startOrResume();
}

async function refreshResumeBar() {
  if (!controller) return;
  await controller.refreshResumeBar();
}

/** Opens the active-workout screen on whatever draft is currently saved in
 * the repo — used by callers (e.g. plans.js starting a workout from a
 * template) that have already built and saved a custom draft via
 * WorkoutRepo.saveDraft and just need the normal screen to take over from
 * there, same as reopening any other in-progress draft. */
async function openExisting() {
  if (!controller) return;
  await controller.openExisting();
}

window.WorkoutActiveFeature = { init, startOrResume, refreshResumeBar, openExisting };

// -- Workout Detail (view/edit/delete a finished workout from the calendar) --
//
// Same toolkit as the active workout screen (exercise row, per-exercise
// note/action row, set table, RIR picker, exercise picker) but reads and
// writes real Workout/WorkoutSet/ExerciseNote records directly instead of
// a draft — there's no timer, no "finish" step, and no 24h expiry check,
// since the workout is already finished; edits just save as you make them.

class WorkoutDetailController {
  constructor() {
    this.overlay = document.getElementById('workout-detail-screen');
    this.closeBtn = document.getElementById('detail-close-btn');
    this.saveBtn = document.getElementById('detail-save-btn');
    this.deleteBtn = document.getElementById('detail-delete-btn');
    this.nameInput = document.getElementById('detail-name-input');
    this.dateInput = document.getElementById('detail-date-input');
    this.exerciseRowEl = document.getElementById('detail-exercise-row');
    this.mainEl = document.getElementById('detail-main');

    // Everything below is a local working copy, edited in place while the
    // screen is open. Nothing touches the database until Save runs
    // (persist()) — minimizing/closing just discards it, same spirit as
    // the active workout's draft never becoming real records until Finish.
    this.workoutId = null;
    this.name = '';
    this.date = '';
    this.sets = []; // { set_id (null if new), _localId, exercise_id, set_number, is_warmup_set, input_1, input_2, rir, rpe, notes }
    this.exerciseNotes = new Map(); // exercise_id -> text
    this.originalSetIds = new Set();
    this.originalNoteExerciseIds = new Set();

    this.exerciseIds = [];
    this.activeExerciseId = null;
    this.exerciseCache = new Map();
    this.previousSetsCache = new Map();
    this.dismissedGlobalNotes = new Set();
    this.dismissedNotes = new Set(); // transient, reset each time the screen opens

    this.picker = sharedExercisePicker;
    this.noteEditor = sharedNoteEditor;
    this.rirPicker = sharedRirPicker;
    this.rpePicker = sharedRpePicker;
    this.gymPicker = sharedGymPicker;
    this.gymsCache = new Map(); // gym_id -> Gym, refreshed each time the screen opens
    this.gymByExercise = new Map(); // exercise_id -> gym_id, seeded from the workout's existing sets
    this.prDialog = sharedPRDialog;

    this.wireEvents();
  }

  wireEvents() {
    this.closeBtn.addEventListener('click', () => this.requestClose());
    this.saveBtn.addEventListener('click', () => this.handleSave());
    this.deleteBtn.addEventListener('click', () => this.handleDeleteWorkout());

    this.nameInput.addEventListener('change', () => {
      this.name = this.nameInput.value.trim();
    });
    this.dateInput.addEventListener('change', () => {
      if (!this.dateInput.value) {
        this.dateInput.value = this.date;
        return;
      }
      this.date = this.dateInput.value;
    });

    window.addEventListener('app:languagechange', () => {
      if (!this.overlay.hidden) this.renderMain();
    });
  }

  async open(workoutId) {
    const workout = await window.WorkoutRepo.getWorkout(workoutId);
    if (!workout) return;

    this.workoutId = workout.id;
    this.name = workout.name;
    this.date = workout.date;

    this.exerciseCache.clear();
    this.previousSetsCache.clear();
    this.dismissedGlobalNotes.clear();
    this.dismissedNotes.clear();

    const records = await window.WorkoutRepo.getSetsForWorkout(workoutId);
    this.sets = records.map((s) => ({
      set_id: s.set_id,
      _localId: s.set_id,
      exercise_id: s.exercise_id,
      set_number: s.set_number,
      is_warmup_set: s.is_warmup_set,
      input_1: s.input_1,
      input_1_right: s.input_1_right,
      input_2: s.input_2,
      rir: s.rir,
      rpe: s.rpe,
      notes: s.notes ?? '',
      gym_id: s.gym_id ?? GENERAL_GYM_ID,
    }));
    this.originalSetIds = new Set(this.sets.map((s) => s.set_id));

    const notes = await window.WorkoutRepo.getExerciseNotesForWorkout(workoutId);
    this.exerciseNotes = new Map(notes.map((n) => [n.exercise_id, n.text]));
    this.originalNoteExerciseIds = new Set(this.exerciseNotes.keys());

    this.nameInput.value = this.name;
    this.dateInput.value = this.date;

    const idSet = new Set(this.sets.map((s) => s.exercise_id));
    await Promise.all([...idSet].map((id) => this.loadExercise(id)));

    // Preserve whatever order the exercises were arranged in (see the Move
    // buttons); older workouts saved before exerciseOrder existed fall back
    // to alphabetical, same as before.
    const storedOrder = Array.isArray(workout.exerciseOrder) ? workout.exerciseOrder : [];
    const ordered = storedOrder.filter((id) => idSet.has(id));
    const remaining = [...idSet].filter((id) => !ordered.includes(id));
    remaining.sort((a, b) => (this.exerciseCache.get(a)?.name ?? '').localeCompare(this.exerciseCache.get(b)?.name ?? ''));
    this.exerciseIds = [...ordered, ...remaining];
    this.activeExerciseId = this.exerciseIds[0] ?? null;

    this.gymByExercise = new Map();
    for (const id of this.exerciseIds) {
      const anySet = this.sets.find((s) => s.exercise_id === id);
      this.gymByExercise.set(id, anySet?.gym_id ?? GENERAL_GYM_ID);
    }
    await this.loadGyms();

    this.initialSnapshot = this.snapshotState();
    this.overlay.hidden = false;
    await this.render();
  }

  /** Everything Save would write, serialized, so closing can tell whether
   * anything was actually changed. */
  snapshotState() {
    return JSON.stringify({
      name: this.name,
      date: this.date,
      exerciseIds: this.exerciseIds,
      sets: this.sets.map(({ _localId, ...rest }) => rest),
      notes: [...this.exerciseNotes.entries()].sort(([a], [b]) => a.localeCompare(b)),
      gyms: [...this.gymByExercise.entries()].sort(([a], [b]) => a.localeCompare(b)),
    });
  }

  /** The X button. Save and Delete close directly; this path is the only
   * one that could silently throw edits away, so it asks first. */
  async requestClose() {
    // A field still focused when X is tapped may not have fired 'change'.
    this.name = this.nameInput.value.trim();
    if (this.dateInput.value) this.date = this.dateInput.value;

    if (this.snapshotState() !== this.initialSnapshot) {
      const discard = await showConfirm({
        title: t('workout.discardChangesTitle'),
        message: t('workout.discardChangesMessage'),
        confirmText: t('workout.discardButton'),
        cancelText: t('workout.keepEditing'),
      });
      if (!discard) return;
    }
    this.close();
  }

  async loadGyms() {
    const gyms = await window.WorkoutRepo.getAllGyms();
    this.gymsCache = new Map(gyms.map((g) => [g.id, g]));
  }

  gymName(gymId) {
    if (gymId === GENERAL_GYM_ID) return t('gyms.general');
    return this.gymsCache.get(gymId)?.name ?? t('gyms.general');
  }

  getExerciseGym(exerciseId) {
    return this.gymByExercise.get(exerciseId) ?? GENERAL_GYM_ID;
  }

  handleSetGym(exerciseId) {
    this.gymPicker.open(this.getExerciseGym(exerciseId), async (gymId) => {
      this.gymByExercise.set(exerciseId, gymId);
      this.sets.filter((s) => s.exercise_id === exerciseId).forEach((s) => {
        s.gym_id = gymId;
      });
      this.previousSetsCache.delete(`${exerciseId}::${gymId}`);
      await this.renderMain();
    });
  }

  /** Minimize/close: discards every local edit made this session. Only
   * Save (persist()) or Delete ever writes to the database. */
  close() {
    this.overlay.hidden = true;
    if (this.onChanged) this.onChanged();
  }

  async loadExercise(exerciseId) {
    if (this.exerciseCache.has(exerciseId)) return this.exerciseCache.get(exerciseId);
    const exercise = await window.WorkoutRepo.getExercise(exerciseId);
    this.exerciseCache.set(exerciseId, exercise);
    return exercise;
  }

  async loadPreviousSets(exerciseId, gymId) {
    const cacheKey = `${exerciseId}::${gymId}`;
    if (this.previousSetsCache.has(cacheKey)) return this.previousSetsCache.get(cacheKey);
    const sets = await window.WorkoutRepo.getPreviousLoggedSetsForExercise(exerciseId, this.workoutId, gymId);
    this.previousSetsCache.set(cacheKey, sets);
    return sets;
  }

  async render() {
    this.renderExerciseRow();
    await this.renderMain();
  }

  renderExerciseRow() {
    this.exerciseRowEl.innerHTML = '';
    this.exerciseIds.forEach((exerciseId) => {
      const exercise = this.exerciseCache.get(exerciseId);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'exercise-row-item';
      if (exerciseId === this.activeExerciseId) btn.classList.add('is-active');
      // A cached null means "looked up, doesn't exist" (deleted) — distinct
      // from "not loaded yet", which is the only case '…' is meant for.
      btn.textContent = exercise
        ? exercise.name
        : this.exerciseCache.has(exerciseId)
          ? t('workout.deletedExercise')
          : '…';
      btn.addEventListener('click', () => this.setActiveExercise(exerciseId));
      this.exerciseRowEl.appendChild(btn);
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'exercise-row-add';
    addBtn.textContent = '+';
    addBtn.setAttribute('aria-label', 'Add exercise');
    addBtn.addEventListener('click', () => this.handleAddExercise());
    this.exerciseRowEl.appendChild(addBtn);
  }

  async setActiveExercise(exerciseId) {
    this.activeExerciseId = exerciseId;
    await this.render();
  }

  newLocalSet(exerciseId, isWarmup, setNumber) {
    return {
      set_id: null,
      _localId: window.WorkoutDB.generateId(),
      exercise_id: exerciseId,
      set_number: setNumber,
      is_warmup_set: isWarmup,
      input_1: null,
      input_1_right: null,
      input_2: null,
      rir: null,
      rpe: null,
      notes: '',
      gym_id: this.getExerciseGym(exerciseId),
    };
  }

  async handleAddExercise() {
    await this.picker.open({
      excludeIds: this.exerciseIds,
      titleKey: 'workout.pickExerciseTitleAdd',
      onPick: async (exerciseId) => {
        this.sets.push(this.newLocalSet(exerciseId, false, 1));
        await this.loadExercise(exerciseId);
        this.exerciseIds.push(exerciseId);
        this.activeExerciseId = exerciseId;
        await this.render();
      },
    });
  }

  async handleSwap(exerciseId) {
    await this.picker.open({
      excludeIds: this.exerciseIds,
      titleKey: 'workout.pickExerciseTitleSwap',
      onPick: async (newExerciseId) => {
        const confirmed = await showConfirm({
          title: t('workout.confirmSwapTitle'),
          message: t('workout.confirmSwapMessage'),
          confirmText: t('workout.swap'),
        });
        if (!confirmed) return;

        this.sets = this.sets.filter((s) => s.exercise_id !== exerciseId);
        this.exerciseNotes.delete(exerciseId);
        this.sets.push(this.newLocalSet(newExerciseId, false, 1));

        const idx = this.exerciseIds.indexOf(exerciseId);
        if (idx !== -1) this.exerciseIds[idx] = newExerciseId;
        if (this.activeExerciseId === exerciseId) this.activeExerciseId = newExerciseId;
        await this.loadExercise(newExerciseId);
        this.previousSetsCache.delete(newExerciseId);
        await this.render();
      },
    });
  }

  async handleRemoveExercise(exerciseId) {
    const confirmed = await showConfirm({
      title: t('workout.confirmRemoveTitle'),
      message: t('workout.confirmRemoveMessage'),
      confirmText: t('workout.remove'),
    });
    if (!confirmed) return;

    this.sets = this.sets.filter((s) => s.exercise_id !== exerciseId);
    this.exerciseNotes.delete(exerciseId);

    this.exerciseIds = this.exerciseIds.filter((id) => id !== exerciseId);
    if (this.activeExerciseId === exerciseId) this.activeExerciseId = this.exerciseIds[0] ?? null;
    await this.render();
  }

  async handleWriteNote(exerciseId) {
    const exercise = await this.loadExercise(exerciseId);

    this.noteEditor.open({
      initialText: this.exerciseNotes.get(exerciseId) ?? '',
      globalNoteText: exercise?.notes ?? '',
      previousNoteText: '',
      onSave: async (text) => {
        if (text && text.trim()) this.exerciseNotes.set(exerciseId, text);
        else this.exerciseNotes.delete(exerciseId);
        this.dismissedNotes.delete(exerciseId); // re-editing un-dismisses it
        await this.renderMain();
      },
    });
  }

  async addSet(exerciseId, isWarmup) {
    const count = this.sets.filter((s) => s.exercise_id === exerciseId && s.is_warmup_set === isWarmup).length;
    this.sets.push(this.newLocalSet(exerciseId, isWarmup, count + 1));
    await this.renderMain();
  }

  async deleteSet(exerciseId, localId) {
    const removed = this.sets.find((s) => s._localId === localId);
    if (!removed) return;

    const confirmed = await showConfirm({
      title: t('workout.confirmDeleteSetTitle'),
      message: t('workout.confirmDeleteSetMessage'),
      confirmText: t('workout.deleteSet'),
    });
    if (!confirmed) return;

    this.sets = this.sets.filter((s) => s._localId !== localId);

    const group = this.sets
      .filter((s) => s.exercise_id === exerciseId && s.is_warmup_set === removed.is_warmup_set)
      .sort((a, b) => a.set_number - b.set_number);
    group.forEach((s, i) => {
      s.set_number = i + 1;
    });

    await this.renderMain();
  }

  async renderMain() {
    this.mainEl.innerHTML = '';

    if (this.exerciseIds.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-state-subtitle';
      empty.style.textAlign = 'center';
      empty.style.marginTop = '48px';
      empty.textContent = t('workout.noExercisesYet');
      this.mainEl.appendChild(empty);
      return;
    }

    const exerciseId = this.activeExerciseId ?? this.exerciseIds[0];
    this.activeExerciseId = exerciseId;

    const exercise = await this.loadExercise(exerciseId);
    if (!exercise) {
      this.mainEl.appendChild(buildDeletedExercisePanel(() => this.handleRemoveExercise(exerciseId)));
      return;
    }

    const mySets = this.sets.filter((s) => s.exercise_id === exerciseId);
    const gymId = this.getExerciseGym(exerciseId);
    const previousSets = await this.loadPreviousSets(exerciseId, gymId);

    this.mainEl.appendChild(this.buildHeading(exercise));

    const globalNoteEl = this.buildGlobalNoteBox(exercise, exerciseId);
    if (globalNoteEl) this.mainEl.appendChild(globalNoteEl);

    const noteEl = this.buildNoteBox(exerciseId);
    if (noteEl) this.mainEl.appendChild(noteEl);

    this.mainEl.appendChild(this.buildActionRow(exercise, exerciseId));
    this.mainEl.appendChild(this.buildSetTable(exercise, mySets, previousSets));
  }

  buildHeading(exercise) {
    const h = document.createElement('h2');
    h.className = 'workout-exercise-name';
    h.textContent = exercise.name;
    return h;
  }

  buildGlobalNoteBox(exercise, exerciseId) {
    if (this.dismissedGlobalNotes.has(exerciseId)) return null;
    if (!exercise.notes || !exercise.notes.trim()) return null;

    const box = document.createElement('div');
    box.className = 'workout-note-box workout-global-note-box';

    const icon = document.createElement('span');
    icon.className = 'workout-note-icon';
    icon.innerHTML =
      '<svg viewBox="0 0 24 24" width="15" height="15"><path d="M4 4h16v12H8l-4 4V4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    const text = document.createElement('span');
    text.className = 'workout-note-text';
    text.textContent = exercise.notes;

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'workout-note-dismiss';
    dismiss.setAttribute('aria-label', t('workout.dismissNote'));
    dismiss.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    dismiss.addEventListener('click', () => {
      this.dismissedGlobalNotes.add(exerciseId);
      this.renderMain();
    });

    box.append(icon, text, dismiss);
    return box;
  }

  /** The note for THIS specific workout (the same text the Note button
   * edits) — unlike the Active Workout screen's buildNoteBox, which shows
   * the carry-forward note from the exercise's last OTHER workout, this
   * shows the workout being edited's own note, straight from the local
   * working copy (this.exerciseNotes), so it always reflects unsaved edits. */
  buildNoteBox(exerciseId) {
    if (this.dismissedNotes.has(exerciseId)) return null;
    const text = this.exerciseNotes.get(exerciseId);
    if (!text || !text.trim()) return null;

    const box = document.createElement('div');
    box.className = 'workout-note-box';

    const textEl = document.createElement('span');
    textEl.className = 'workout-note-text';
    textEl.textContent = text;

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'workout-note-dismiss';
    dismiss.setAttribute('aria-label', t('workout.dismissNote'));
    dismiss.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    dismiss.addEventListener('click', () => {
      this.dismissedNotes.add(exerciseId);
      this.renderMain();
    });

    box.append(textEl, dismiss);
    return box;
  }

  buildActionRow(exercise, exerciseId) {
    const row = document.createElement('div');
    row.className = 'workout-action-row';

    const addSetBtn = document.createElement('button');
    addSetBtn.type = 'button';
    addSetBtn.className = 'workout-action-btn';
    addSetBtn.textContent = t('workout.addSet');
    addSetBtn.addEventListener('click', () => this.addSet(exerciseId, false));

    const addWarmupBtn = document.createElement('button');
    addWarmupBtn.type = 'button';
    addWarmupBtn.className = 'workout-action-btn';
    addWarmupBtn.textContent = t('workout.addWarmup');
    addWarmupBtn.addEventListener('click', () => this.addSet(exerciseId, true));

    const swapBtn = document.createElement('button');
    swapBtn.type = 'button';
    swapBtn.className = 'workout-action-btn';
    swapBtn.textContent = t('workout.swap');
    swapBtn.addEventListener('click', () => this.handleSwap(exerciseId));

    const noteBtn = document.createElement('button');
    noteBtn.type = 'button';
    noteBtn.className = 'workout-action-btn';
    noteBtn.textContent = t('workout.note');
    noteBtn.addEventListener('click', () => this.handleWriteNote(exerciseId));

    const gymBtn = document.createElement('button');
    gymBtn.type = 'button';
    gymBtn.className = 'workout-action-btn';
    gymBtn.textContent = `${t('workout.gym')}: ${this.gymName(this.getExerciseGym(exerciseId))}`;
    gymBtn.addEventListener('click', () => this.handleSetGym(exerciseId));

    const prBtn = document.createElement('button');
    prBtn.type = 'button';
    prBtn.className = 'workout-action-btn';
    prBtn.textContent = t('workout.prButton');
    prBtn.addEventListener('click', () => this.handleOpenPR(exerciseId));

    const idx = this.exerciseIds.indexOf(exerciseId);

    const moveLeftBtn = document.createElement('button');
    moveLeftBtn.type = 'button';
    moveLeftBtn.className = 'workout-action-btn workout-action-btn-icon';
    moveLeftBtn.setAttribute('aria-label', t('workout.moveLeft'));
    moveLeftBtn.disabled = idx <= 0;
    moveLeftBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    moveLeftBtn.addEventListener('click', () => this.moveExercise(exerciseId, -1));

    const moveRightBtn = document.createElement('button');
    moveRightBtn.type = 'button';
    moveRightBtn.className = 'workout-action-btn workout-action-btn-icon';
    moveRightBtn.setAttribute('aria-label', t('workout.moveRight'));
    moveRightBtn.disabled = idx === -1 || idx >= this.exerciseIds.length - 1;
    moveRightBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    moveRightBtn.addEventListener('click', () => this.moveExercise(exerciseId, 1));

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'workout-action-btn workout-action-btn-danger';
    removeBtn.textContent = t('workout.remove');
    removeBtn.addEventListener('click', () => this.handleRemoveExercise(exerciseId));

    row.append(addSetBtn, addWarmupBtn, swapBtn, noteBtn, gymBtn, prBtn, moveLeftBtn, moveRightBtn, removeBtn);
    return row;
  }

  async handleOpenPR(exerciseId) {
    const exercise = await this.loadExercise(exerciseId);
    const gymId = this.getExerciseGym(exerciseId);
    await this.prDialog.open({
      exercise,
      exerciseId,
      gymId,
      gymName: this.gymName(gymId),
      getCurrentSets: () => this.sets.filter((s) => s.exercise_id === exerciseId),
      // Reviewing an old workout: only PRs that stood *before* this
      // workout's own date count as "current best" — never a look-ahead
      // from a PR set later (including one marked during this workout).
      beforeDate: this.date,
    });
  }

  async moveExercise(exerciseId, direction) {
    const idx = this.exerciseIds.indexOf(exerciseId);
    if (idx === -1) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= this.exerciseIds.length) return;

    [this.exerciseIds[idx], this.exerciseIds[newIdx]] = [this.exerciseIds[newIdx], this.exerciseIds[idx]];
    await this.render();
  }

  buildSetTable(exercise, mySets, previousSets) {
    const metric = exercise.metric;
    const showInput2 = !!metric && !!metric.unit && metric.unit !== 'none';
    const showEffort = exercise.effortTracking !== 'none';
    const isPerSide = metric?.type === 'reps_per_side';

    const table = document.createElement('table');
    table.className = 'set-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headRow.appendChild(this.th(t('workout.tableSet')));
    headRow.appendChild(this.th(t('workout.tablePrevious')));
    if (isPerSide) {
      headRow.appendChild(this.th(t('workout.sideLeft')));
      headRow.appendChild(this.th(t('workout.sideRight')));
    } else {
      headRow.appendChild(this.th(metricTypeColumnLabel(metric)));
    }
    if (showInput2) headRow.appendChild(this.th(metricUnitColumnLabel(metric)));
    if (showEffort) headRow.appendChild(this.th(exercise.effortTracking === 'rir' ? 'RIR' : 'RPE'));
    headRow.appendChild(this.th(''));
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const ordered = mySets.slice().sort((a, b) => {
      if (a.is_warmup_set !== b.is_warmup_set) return a.is_warmup_set ? -1 : 1;
      return a.set_number - b.set_number;
    });

    ordered.forEach((set) => {
      const tr = document.createElement('tr');
      if (set.is_warmup_set) tr.classList.add('is-warmup');

      const label = document.createElement('td');
      label.className = 'set-cell-label';
      label.textContent = `${set.is_warmup_set ? 'W' : ''}${set.set_number}`;
      tr.appendChild(label);

      const prevMatch = previousSets.find(
        (p) => p.is_warmup_set === set.is_warmup_set && p.set_number === set.set_number
      );
      const prevCell = document.createElement('td');
      prevCell.className = 'set-cell-previous';
      prevCell.textContent = prevMatch ? formatSetSummary(exercise, prevMatch) : '—';
      tr.appendChild(prevCell);

      if (isPerSide) {
        tr.appendChild(this.inputCell(set, 'input_1', 'natural', ''));
        tr.appendChild(this.inputCell(set, 'input_1_right', 'natural', ''));
      } else {
        const input1Format = INPUT_FORMAT_BY_TYPE[metric?.type] ?? null;
        const input1Placeholder = metric?.type === 'min_sec' ? 'mm:ss' : metric?.type === 'hr_min' ? 'hh:mm' : '';
        tr.appendChild(this.inputCell(set, 'input_1', input1Format, input1Placeholder));
      }
      if (showInput2) {
        tr.appendChild(this.inputCell(set, 'input_2', INPUT_FORMAT_BY_UNIT[metric.unit] ?? null, ''));
      }
      if (showEffort) {
        const isRir = exercise.effortTracking === 'rir';
        tr.appendChild(isRir ? this.buildRirCell(set) : this.buildRpeCell(set));
      }

      const deleteCell = document.createElement('td');
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'set-delete-btn';
      deleteBtn.setAttribute('aria-label', t('workout.deleteSet'));
      deleteBtn.innerHTML =
        '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      deleteBtn.addEventListener('click', () => this.deleteSet(exercise.id, set._localId));
      deleteCell.appendChild(deleteBtn);
      tr.appendChild(deleteCell);

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);

    const wrap = document.createElement('div');
    wrap.className = 'set-table-wrap';
    wrap.appendChild(table);
    return wrap;
  }

  th(text) {
    const el = document.createElement('th');
    el.textContent = text;
    return el;
  }

  inputCell(set, field, format = null, placeholder = '') {
    const td = document.createElement('td');
    const input = document.createElement('input');
    input.className = 'set-input';
    input.type = 'text';
    input.inputMode = format === 'rational' ? 'decimal' : 'numeric';
    if (placeholder) input.placeholder = placeholder;
    input.value = set[field] ?? '';
    input.addEventListener('change', () => {
      const raw = format ? sanitizeInputValue(input.value.trim(), format) : input.value.trim();
      input.value = raw;
      set[field] = raw === '' ? null : raw;
    });
    td.appendChild(input);
    return td;
  }

  buildRirCell(set) {
    const td = document.createElement('td');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'set-input';
    btn.textContent = set.rir ?? '';
    if (set.rir != null && RIR_COLORS[set.rir] != null) {
      btn.style.background = RIR_COLORS[set.rir];
      btn.style.color = '#fff';
      btn.style.fontWeight = '700';
    }
    btn.addEventListener('click', () => {
      this.rirPicker.open((value) => {
        set.rir = value === '' ? null : value;
        this.renderMain();
      });
    });
    td.appendChild(btn);
    return td;
  }

  buildRpeCell(set) {
    const td = document.createElement('td');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'set-input';
    btn.textContent = set.rpe ?? '';
    if (set.rpe != null && RPE_COLORS[set.rpe] != null) {
      btn.style.background = RPE_COLORS[set.rpe];
      btn.style.color = '#fff';
      btn.style.fontWeight = '700';
    }
    btn.addEventListener('click', () => {
      this.rpePicker.open((value) => {
        set.rpe = value === '' ? null : value;
        this.renderMain();
      });
    });
    td.appendChild(btn);
    return td;
  }

  /**
   * Same idea as the active workout's Finish flow: if any set is missing a
   * required value, warn that they'll be deleted before proceeding (there's
   * no "done" checkbox in history — a set counts as incomplete here if it's
   * missing Input 1, or Input 2 when the exercise's metric has a unit).
   * This is also the only point where local edits actually reach the
   * database — see persist().
   */
  async handleSave() {
    const incomplete = [];
    for (const set of this.sets) {
      const exercise = await this.loadExercise(set.exercise_id);
      if (!setHasRequiredValues(exercise, set)) incomplete.push(set);
    }

    if (incomplete.length > 0) {
      const proceed = await showConfirm({
        title: t('workout.confirmIncompleteTitle'),
        message: t('workout.confirmIncompleteMessage'),
      });
      if (!proceed) return;

      const incompleteIds = new Set(incomplete.map((s) => s._localId));
      this.sets = this.sets.filter((s) => !incompleteIds.has(s._localId));

      const groups = new Map();
      this.sets.forEach((s) => {
        const key = `${s.exercise_id}:${s.is_warmup_set}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(s);
      });
      for (const group of groups.values()) {
        group.sort((a, b) => a.set_number - b.set_number);
        group.forEach((s, i) => {
          s.set_number = i + 1;
        });
      }
    }

    await this.persist();
    this.close();
  }

  /** Writes the local working copy to the real Workout/WorkoutSet/
   * ExerciseNote records. Only called from handleSave — minimizing never
   * calls this, so nothing is saved unless Save was explicitly tapped. */
  async persist() {
    await window.WorkoutRepo.updateWorkout({
      id: this.workoutId,
      name: this.name,
      date: this.date,
      exerciseOrder: this.exerciseIds,
    });

    const currentSetIds = new Set(this.sets.filter((s) => s.set_id).map((s) => s.set_id));
    for (const originalId of this.originalSetIds) {
      if (!currentSetIds.has(originalId)) await window.WorkoutRepo.deleteWorkoutSet(originalId);
    }

    for (const set of this.sets) {
      const data = {
        set_id: set.set_id ?? undefined,
        exercise_id: set.exercise_id,
        workout_id: this.workoutId,
        set_number: set.set_number,
        is_warmup_set: set.is_warmup_set,
        input_1: set.input_1,
        input_1_right: set.input_1_right,
        input_2: set.input_2,
        rir: set.rir,
        rpe: set.rpe,
        notes: set.notes,
        gym_id: set.gym_id ?? GENERAL_GYM_ID,
      };
      if (set.set_id) await window.WorkoutRepo.updateWorkoutSet(data);
      else await window.WorkoutRepo.createWorkoutSet(data);
    }

    const touchedExerciseIds = new Set([...this.exerciseNotes.keys(), ...this.originalNoteExerciseIds]);
    for (const exerciseId of touchedExerciseIds) {
      const text = this.exerciseNotes.get(exerciseId) ?? '';
      await window.WorkoutRepo.upsertExerciseNoteForWorkout(exerciseId, this.workoutId, text);
    }
  }

  async handleDeleteWorkout() {
    const confirmed = await showConfirm({
      title: t('workout.confirmDeleteWorkoutTitle'),
      message: t('workout.confirmDeleteWorkoutMessage'),
      confirmText: t('workout.deleteWorkout'),
    });
    if (!confirmed) return;

    await window.WorkoutRepo.deleteWorkout(this.workoutId);
    this.close();
  }
}

let detailController = null;

function initDetail({ onChanged } = {}) {
  detailController = new WorkoutDetailController();
  detailController.onChanged = onChanged;
}

async function openWorkoutDetail(workoutId) {
  if (!detailController) return;
  await detailController.open(workoutId);
}

window.WorkoutHistoryFeature = { init: initDetail, open: openWorkoutDetail };
window.WorkoutDialogs = { showConfirm, showTextPrompt, runExclusive };

// Cross-file access to the shared singleton pickers (see the "Shared
// singleton overlays" convention in ARCHITECTURE.md) — plans.js reuses
// these exact instances rather than constructing its own, which would
// double-bind their backing DOM elements' click handlers.
window.WorkoutSharedPickers = {
  exercisePicker: sharedExercisePicker,
  rirPicker: sharedRirPicker,
  rpePicker: sharedRpePicker,
  RIR_COLORS,
  RPE_COLORS,
};

})();
