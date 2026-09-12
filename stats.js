'use strict';

/*
 * Stats tab: the shared date-range selector plus three stats categories,
 * each reached via its own button (Sets per Muscle Group / Avg Sets per
 * Workout / Muscle Group Frequency / Workout Stats / Exercise Rankings —
 * mirroring the existing "Exercise Stats" button pattern instead of one
 * long scrolling page). Distinct from the "Exercise Stats" picker in
 * exercises.js, which opens the shared per-exercise History/PR/Chart view
 * (workout.js) — that feature is unrelated to and unchanged by this one.
 * Everything here is computed live from window.WorkoutRepo every time a
 * screen is opened (or the range changes); nothing is persisted.
 */

(function () {

function getLang() {
  return window.WorkoutI18nState ? window.WorkoutI18nState.get() : window.I18n.DEFAULT_LANGUAGE;
}

function t(key, params) {
  return window.I18n.t(key, getLang(), params);
}

function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function todayDateKey() {
  return toDateKey(new Date());
}

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sun .. 6 = Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysBetweenInclusive(startDate, endDate) {
  if (!startDate || !endDate) return 0;
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  return Math.round((end - start) / 86400000) + 1;
}

/** Partial ranges (e.g. "This Week" on a Tuesday) still get a sensible
 * weekly-rate denominator instead of dividing by a fractional/zero count. */
function weeksInRange(startDate, endDate) {
  const days = daysBetweenInclusive(startDate, endDate);
  return Math.max(days, 1) / 7;
}

const NON_NONE_MUSCLE_GROUPS = window.WorkoutModels.MUSCLE_GROUPS.filter((g) => g !== 'none');

/** Shared aggregation behind all three Muscle Group Stats screens: one
 * WorkoutRepo.getRangeStatsData call joined against every exercise's
 * muscleGroups[]. Returns per-group total set counts and, per group, a
 * Map(workoutId -> set count in that workout) — the latter is what lets
 * "average/frequency where trained" only count workouts that actually
 * touched that muscle group (a leg day never counts toward chest). */
async function computeMuscleGroupStats(startDate, endDate) {
  const { sets } = await window.WorkoutRepo.getRangeStatsData(startDate, endDate);
  const exercises = await window.WorkoutRepo.getAllExercises();
  const exerciseById = new Map(exercises.map((e) => [e.id, e]));

  const totalSetsByGroup = {};
  const perWorkoutByGroup = {};

  for (const s of sets) {
    const ex = exerciseById.get(s.exercise_id);
    if (!ex) continue;
    for (const g of ex.muscleGroups) {
      if (g === 'none') continue;
      totalSetsByGroup[g] = (totalSetsByGroup[g] || 0) + 1;
      if (!perWorkoutByGroup[g]) perWorkoutByGroup[g] = new Map();
      const m = perWorkoutByGroup[g];
      m.set(s.workout_id, (m.get(s.workout_id) || 0) + 1);
    }
  }

  return { totalSetsByGroup, perWorkoutByGroup };
}

// -- Shared date-range selector -------------------------------------------

class StatsRangeController {
  constructor() {
    this.openBtn = document.getElementById('open-stats-range-btn');
    this.valueEl = document.getElementById('stats-range-value');
    this.overlay = document.getElementById('stats-range-picker');
    this.cancelBtn = document.getElementById('stats-range-cancel-btn');
    this.optionsEl = document.getElementById('stats-range-options');
    this.daysChipsEl = document.getElementById('stats-range-days-chips');
    this.customInput = document.getElementById('stats-range-custom-input');
    this.customApplyBtn = document.getElementById('stats-range-custom-apply-btn');
    this.startInput = document.getElementById('stats-range-start-input');
    this.endInput = document.getElementById('stats-range-end-input');
    this.customDatesApplyBtn = document.getElementById('stats-range-custom-dates-apply-btn');

    this.range = { type: 'month' };

    this.openBtn.addEventListener('click', () => this.open());
    this.cancelBtn.addEventListener('click', () => this.close());
    this.customApplyBtn.addEventListener('click', () => this.applyCustomDays());
    this.customDatesApplyBtn.addEventListener('click', () => this.applyCustomDates());
    window.addEventListener('app:languagechange', () => {
      this.updateValueLabel();
      if (!this.overlay.hidden) this.renderOptions();
    });

    this.updateValueLabel();
  }

  open() {
    this.renderOptions();
    this.overlay.hidden = false;
  }

  close() {
    this.overlay.hidden = true;
  }

  renderOptions() {
    this.optionsEl.innerHTML = '';
    [
      { type: 'week', label: t('stats.rangeThisWeek') },
      { type: 'month', label: t('stats.rangeThisMonth') },
      { type: 'year', label: t('stats.rangeThisYear') },
      { type: 'all', label: t('stats.rangeAllTime') },
    ].forEach((opt) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'stats-range-option';
      if (this.range.type === opt.type) btn.classList.add('is-selected');
      btn.textContent = opt.label;
      btn.addEventListener('click', () => this.selectRange({ type: opt.type }));
      this.optionsEl.appendChild(btn);
    });

    this.daysChipsEl.innerHTML = '';
    [30, 90, 182, 365].forEach((n) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      if (this.range.type === 'days' && this.range.days === n) chip.classList.add('is-selected');
      chip.textContent = String(n);
      chip.addEventListener('click', () => this.selectRange({ type: 'days', days: n }));
      this.daysChipsEl.appendChild(chip);
    });

    const isCustomDays = this.range.type === 'days' && ![30, 90, 182, 365].includes(this.range.days);
    this.customInput.value = isCustomDays ? this.range.days : '';

    if (this.range.type === 'range') {
      this.startInput.value = this.range.startDate;
      this.endInput.value = this.range.endDate;
    }
  }

  applyCustomDays() {
    const n = parseInt(this.customInput.value, 10);
    if (!n || n <= 0) return;
    this.selectRange({ type: 'days', days: n });
  }

  applyCustomDates() {
    const startDate = this.startInput.value;
    const endDate = this.endInput.value;
    if (!startDate || !endDate || startDate > endDate) return;
    this.selectRange({ type: 'range', startDate, endDate });
  }

  selectRange(range) {
    this.range = range;
    this.updateValueLabel();
    this.close();
  }

  updateValueLabel() {
    this.valueEl.textContent = this.describeRange();
  }

  describeRange() {
    switch (this.range.type) {
      case 'week':
        return t('stats.rangeThisWeek');
      case 'month':
        return t('stats.rangeThisMonth');
      case 'year':
        return t('stats.rangeThisYear');
      case 'all':
        return t('stats.rangeAllTime');
      case 'days':
        return t('stats.rangeLastXDays', { days: this.range.days });
      case 'range':
        return `${this.range.startDate} – ${this.range.endDate}`;
      default:
        return '';
    }
  }

  /** Resolves the current selection to concrete inclusive {startDate,
   * endDate} ISO strings. 'all' needs an async lookup for the true start
   * (the earliest workout ever logged); startDate comes back null if
   * there's no workout history yet. 'range' is already concrete — the
   * user's own start/end dates, both inclusive. */
  async resolveDates() {
    const endDate = todayDateKey();
    switch (this.range.type) {
      case 'week':
        return { startDate: toDateKey(startOfWeek(new Date())), endDate };
      case 'month': {
        const now = new Date();
        return { startDate: toDateKey(new Date(now.getFullYear(), now.getMonth(), 1)), endDate };
      }
      case 'year': {
        const now = new Date();
        return { startDate: toDateKey(new Date(now.getFullYear(), 0, 1)), endDate };
      }
      case 'days': {
        const start = new Date();
        start.setDate(start.getDate() - (this.range.days - 1));
        return { startDate: toDateKey(start), endDate };
      }
      case 'range':
        return { startDate: this.range.startDate, endDate: this.range.endDate };
      case 'all':
      default: {
        const earliest = await window.WorkoutRepo.getEarliestWorkoutDate();
        return { startDate: earliest, endDate };
      }
    }
  }
}

// -- Sets per Muscle Group (bar chart) --------------------------------------

class MuscleSetsScreenController {
  constructor(rangeController) {
    this.rangeController = rangeController;
    this.openBtn = document.getElementById('open-stats-muscle-sets-btn');
    this.closeBtn = document.getElementById('stats-muscle-sets-close-btn');
    this.overlay = document.getElementById('stats-muscle-sets-screen');
    this.chartEl = document.getElementById('stats-muscle-sets-chart');
    this.emptyEl = document.getElementById('stats-muscle-sets-empty');

    this.openBtn.addEventListener('click', () => this.open());
    this.closeBtn.addEventListener('click', () => this.close());
    window.addEventListener('app:languagechange', () => {
      if (!this.overlay.hidden) this.render();
    });
  }

  async open() {
    this.overlay.hidden = false;
    await this.render();
  }

  close() {
    this.overlay.hidden = true;
  }

  async render() {
    const { startDate, endDate } = await this.rangeController.resolveDates();
    const { totalSetsByGroup } = await computeMuscleGroupStats(startDate, endDate);
    const lang = getLang();

    const bars = NON_NONE_MUSCLE_GROUPS.map((g) => ({
      label: window.I18n.t(`muscleGroup.${g}`, lang),
      value: totalSetsByGroup[g] || 0,
    })).sort((a, b) => b.value - a.value);

    const hasAny = bars.some((b) => b.value > 0);
    this.chartEl.innerHTML = '';
    this.chartEl.hidden = !hasAny;
    this.emptyEl.hidden = hasAny;
    if (!hasAny) return;

    this.chartEl.appendChild(window.WorkoutCharts.buildBarChartSvg(bars));
  }
}

// -- Avg Sets per Workout (where trained) ------------------------------------

class MuscleAvgScreenController {
  constructor(rangeController) {
    this.rangeController = rangeController;
    this.openBtn = document.getElementById('open-stats-muscle-avg-btn');
    this.closeBtn = document.getElementById('stats-muscle-avg-close-btn');
    this.overlay = document.getElementById('stats-muscle-avg-screen');
    this.listEl = document.getElementById('stats-muscle-avg-list');

    this.openBtn.addEventListener('click', () => this.open());
    this.closeBtn.addEventListener('click', () => this.close());
    window.addEventListener('app:languagechange', () => {
      if (!this.overlay.hidden) this.render();
    });
  }

  async open() {
    this.overlay.hidden = false;
    await this.render();
  }

  close() {
    this.overlay.hidden = true;
  }

  async render() {
    const { startDate, endDate } = await this.rangeController.resolveDates();
    const { perWorkoutByGroup } = await computeMuscleGroupStats(startDate, endDate);
    const lang = getLang();

    this.listEl.innerHTML = '';
    NON_NONE_MUSCLE_GROUPS.forEach((g) => {
      const m = perWorkoutByGroup[g];
      const row = document.createElement('div');
      row.className = 'stats-list-row';

      const label = document.createElement('span');
      label.className = 'stats-list-row-label';
      label.textContent = window.I18n.t(`muscleGroup.${g}`, lang);

      const value = document.createElement('span');
      value.className = 'stats-list-row-value';
      if (!m || m.size === 0) {
        value.textContent = t('stats.notTrainedInRange');
      } else {
        const total = [...m.values()].reduce((a, b) => a + b, 0);
        value.textContent = t('stats.avgSetsValue', { avg: (total / m.size).toFixed(1) });
      }

      row.append(label, value);
      this.listEl.appendChild(row);
    });
  }
}

// -- Muscle Group Frequency ---------------------------------------------------

class MuscleFrequencyScreenController {
  constructor(rangeController) {
    this.rangeController = rangeController;
    this.openBtn = document.getElementById('open-stats-muscle-frequency-btn');
    this.closeBtn = document.getElementById('stats-muscle-frequency-close-btn');
    this.overlay = document.getElementById('stats-muscle-frequency-screen');
    this.listEl = document.getElementById('stats-muscle-frequency-list');

    this.openBtn.addEventListener('click', () => this.open());
    this.closeBtn.addEventListener('click', () => this.close());
    window.addEventListener('app:languagechange', () => {
      if (!this.overlay.hidden) this.render();
    });
  }

  async open() {
    this.overlay.hidden = false;
    await this.render();
  }

  close() {
    this.overlay.hidden = true;
  }

  async render() {
    const { startDate, endDate } = await this.rangeController.resolveDates();
    const { perWorkoutByGroup } = await computeMuscleGroupStats(startDate, endDate);
    const weeks = weeksInRange(startDate, endDate);
    const lang = getLang();

    this.listEl.innerHTML = '';
    NON_NONE_MUSCLE_GROUPS.forEach((g) => {
      const m = perWorkoutByGroup[g];
      const row = document.createElement('div');
      row.className = 'stats-list-row';

      const label = document.createElement('span');
      label.className = 'stats-list-row-label';
      label.textContent = window.I18n.t(`muscleGroup.${g}`, lang);

      const value = document.createElement('span');
      value.className = 'stats-list-row-value';
      if (!m || m.size === 0) {
        value.textContent = t('stats.notTrainedInRange');
      } else {
        value.textContent = t('stats.timesPerWeekValue', { freq: (m.size / weeks).toFixed(1) });
      }

      row.append(label, value);
      this.listEl.appendChild(row);
    });
  }
}

// -- Workout Stats -----------------------------------------------------------

class WorkoutStatsScreenController {
  constructor(rangeController) {
    this.rangeController = rangeController;
    this.openBtn = document.getElementById('open-stats-workout-btn');
    this.closeBtn = document.getElementById('stats-workout-close-btn');
    this.overlay = document.getElementById('stats-workout-screen');
    this.freqEl = document.getElementById('stats-training-frequency');
    this.currentStreakEl = document.getElementById('stats-current-streak');
    this.longestStreakEl = document.getElementById('stats-longest-streak');
    this.ratioEl = document.getElementById('stats-training-day-ratio');

    this.openBtn.addEventListener('click', () => this.open());
    this.closeBtn.addEventListener('click', () => this.close());
    window.addEventListener('app:languagechange', () => {
      if (!this.overlay.hidden) this.render();
    });
  }

  async open() {
    this.overlay.hidden = false;
    await this.render();
  }

  close() {
    this.overlay.hidden = true;
  }

  async render() {
    const { startDate, endDate } = await this.rangeController.resolveDates();
    const workouts = await window.WorkoutRepo.getWorkoutsInRange(startDate, endDate);
    const freq = workouts.length / weeksInRange(startDate, endDate);
    this.freqEl.textContent = t('stats.timesPerWeekValue', { freq: freq.toFixed(1) });

    // Streaks are deliberately all-time, not scoped by the range selector —
    // see WorkoutRepo.getWeeklyStreaks.
    const streaks = await window.WorkoutRepo.getWeeklyStreaks();
    this.currentStreakEl.textContent = String(streaks.current);
    this.longestStreakEl.textContent = String(streaks.longest);

    const trainingDays = new Set(workouts.map((w) => w.date)).size;
    const totalDays = daysBetweenInclusive(startDate, endDate);
    const restDays = Math.max(totalDays - trainingDays, 0);
    const pct = totalDays > 0 ? Math.round((trainingDays / totalDays) * 100) : 0;
    this.ratioEl.textContent = t('stats.trainingDayRatioValue', {
      trained: trainingDays,
      rest: restDays,
      total: totalDays,
      pct,
    });
  }
}

// -- Exercise Rankings ---------------------------------------------------------

class ExerciseRankingsScreenController {
  constructor(rangeController) {
    this.rangeController = rangeController;
    this.openBtn = document.getElementById('open-stats-rankings-btn');
    this.closeBtn = document.getElementById('stats-rankings-close-btn');
    this.overlay = document.getElementById('stats-rankings-screen');
    this.tabsEl = document.getElementById('stats-ranking-tabs');
    this.listEl = document.getElementById('stats-ranking-list');
    this.emptyEl = document.getElementById('stats-ranking-empty');
    this.mode = 'most';
    this.counts = [];

    this.openBtn.addEventListener('click', () => this.open());
    this.closeBtn.addEventListener('click', () => this.close());
    this.tabsEl.querySelectorAll('.segmented-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.mode = btn.dataset.mode;
        this.tabsEl.querySelectorAll('.segmented-option').forEach((b) => b.classList.toggle('is-active', b === btn));
        this.renderList();
      });
    });
    window.addEventListener('app:languagechange', () => {
      if (!this.overlay.hidden) this.renderList();
    });
  }

  async open() {
    this.overlay.hidden = false;
    await this.render();
  }

  close() {
    this.overlay.hidden = true;
  }

  async render() {
    const { startDate, endDate } = await this.rangeController.resolveDates();
    const { sets } = await window.WorkoutRepo.getRangeStatsData(startDate, endDate);
    const exercises = await window.WorkoutRepo.getAllExercises();

    const counts = new Map();
    for (const s of sets) counts.set(s.exercise_id, (counts.get(s.exercise_id) || 0) + 1);
    this.counts = exercises.map((exercise) => ({ exercise, count: counts.get(exercise.id) || 0 }));

    this.renderList();
  }

  renderList() {
    const list =
      this.mode === 'most'
        ? this.counts.filter((c) => c.count > 0).sort((a, b) => b.count - a.count)
        : this.counts.slice().sort((a, b) => a.count - b.count);

    this.listEl.innerHTML = '';
    this.listEl.hidden = list.length === 0;
    this.emptyEl.hidden = list.length > 0;
    if (list.length === 0) return;

    list.forEach(({ exercise, count }) => {
      const row = document.createElement('div');
      row.className = 'stats-list-row';

      const label = document.createElement('span');
      label.className = 'stats-list-row-label';
      label.textContent = exercise.name;

      const value = document.createElement('span');
      value.className = 'stats-list-row-value';
      value.textContent = t('stats.setsCountValue', { count });

      row.append(label, value);
      this.listEl.appendChild(row);
    });
  }
}

// -- Wiring -------------------------------------------------------------

function initStats() {
  const rangeController = new StatsRangeController();
  new MuscleSetsScreenController(rangeController);
  new MuscleAvgScreenController(rangeController);
  new MuscleFrequencyScreenController(rangeController);
  new WorkoutStatsScreenController(rangeController);
  new ExerciseRankingsScreenController(rangeController);

  return { rangeController };
}

window.WorkoutStatsExtras = { init: initStats };

})();
