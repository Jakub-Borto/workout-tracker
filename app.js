'use strict';

(function () {

const WEEKDAY_KEYS = [
  'weekday.mon',
  'weekday.tue',
  'weekday.wed',
  'weekday.thu',
  'weekday.fri',
  'weekday.sat',
  'weekday.sun',
];

let currentLanguage = window.I18n.DEFAULT_LANGUAGE;
let homeControllerInstance = null;

// Read-only accessor other modules (exercises.js) can use without needing
// their own copy of the language state.
window.WorkoutI18nState = { get: () => currentLanguage };

function applyTranslations(language) {
  document.documentElement.lang = language;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = window.I18n.t(el.dataset.i18n, language);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = window.I18n.t(el.dataset.i18nPlaceholder, language);
  });
}

function updateLanguageSwitchUI(language) {
  document.querySelectorAll('#language-switch .segmented-option').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.lang === language);
  });
}

async function setAppLanguage(language) {
  currentLanguage = language;
  applyTranslations(language);
  updateLanguageSwitchUI(language);
  if (homeControllerInstance) homeControllerInstance.render();
  window.dispatchEvent(new CustomEvent('app:languagechange', { detail: { language } }));
  try {
    await window.I18n.setLanguage(language);
  } catch (err) {
    console.error('Failed to persist language setting', err);
  }
}

function wireLanguageSwitch() {
  document.querySelectorAll('#language-switch .segmented-option').forEach((btn) => {
    btn.addEventListener('click', () => setAppLanguage(btn.dataset.lang));
  });
}

function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sun .. 6 = Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  d.setHours(0, 0, 0, 0);
  return d;
}

class NavController {
  constructor({ onNavigate } = {}) {
    this.onNavigate = onNavigate ?? (() => {});
    this.navItems = Array.from(document.querySelectorAll('.nav-item'));
    this.screens = Array.from(document.querySelectorAll('.screen'));
    this.navItems.forEach((btn) => {
      btn.addEventListener('click', () => this.goTo(btn.dataset.target));
    });
  }

  goTo(target) {
    this.navItems.forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.target === target);
    });
    this.screens.forEach((screen) => {
      screen.hidden = screen.dataset.screen !== target;
    });
    if (this.onNavigate) this.onNavigate(target);
  }
}

class HomeController {
  constructor() {
    this.weekLabelEl = document.getElementById('week-label');
    this.weekGridEl = document.getElementById('week-grid');
    this.prevBtn = document.getElementById('week-prev-btn');
    this.nextBtn = document.getElementById('week-next-btn');
    this.startWorkoutBtn = document.getElementById('start-workout-btn');

    this.referenceWeekStart = startOfWeek(new Date());
    this.workoutDatesForWeek = new Set();

    this.prevBtn.addEventListener('click', () => this.shiftWeek(-1));
    this.nextBtn.addEventListener('click', () => this.shiftWeek(1));
    this.startWorkoutBtn.addEventListener('click', () => this.handleStartWorkout());

    this.render();
  }

  shiftWeek(deltaWeeks) {
    const d = new Date(this.referenceWeekStart);
    d.setDate(d.getDate() + deltaWeeks * 7);
    this.referenceWeekStart = d;
    this.render();
  }

  async handleStartWorkout() {
    await window.WorkoutActiveFeature.startOrResume();
  }

  async handleDayTap(dateKey, hasWorkout) {
    if (!hasWorkout) return;
    const workouts = await window.WorkoutRepo.getAllWorkouts();
    const match = workouts.find((w) => w.date === dateKey);
    if (match) await window.WorkoutHistoryFeature.open(match.id);
  }

  async render() {
    const weekStart = this.referenceWeekStart;
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    this.weekLabelEl.textContent = this.formatWeekLabel(weekStart, weekEnd);

    const workoutDates = await this.fetchWorkoutDatesInRange(weekStart, weekEnd);

    this.weekGridEl.innerHTML = '';
    const today = new Date();
    const todayKey = toDateKey(today);

    for (let i = 0; i < 7; i += 1) {
      const day = new Date(weekStart);
      day.setDate(day.getDate() + i);
      const dateKey = toDateKey(day);
      const hasWorkout = workoutDates.has(dateKey);
      const isToday = dateKey === todayKey;

      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'day-cell';
      if (isToday) cell.classList.add('is-today');
      if (hasWorkout) cell.classList.add('has-workout');
      cell.setAttribute('aria-label', `${dateKey}${hasWorkout ? ', workout logged' : ''}`);

      const weekday = document.createElement('span');
      weekday.className = 'day-weekday';
      weekday.textContent = window.I18n.t(WEEKDAY_KEYS[i], currentLanguage);

      const number = document.createElement('span');
      number.className = 'day-number';
      number.textContent = String(day.getDate());

      const dot = document.createElement('span');
      dot.className = 'day-dot';

      cell.append(weekday, number, dot);
      cell.addEventListener('click', () => this.handleDayTap(dateKey, hasWorkout));

      this.weekGridEl.appendChild(cell);
    }
  }

  formatWeekLabel(start, end) {
    const optsSameMonth = { month: 'short', day: 'numeric' };
    const locale = window.I18n.localeFor(currentLanguage);
    const startStr = start.toLocaleDateString(locale, optsSameMonth);
    const endStr = end.toLocaleDateString(locale, optsSameMonth);
    return `${startStr} – ${endStr}`;
  }

  async fetchWorkoutDatesInRange(start, end) {
    const dates = new Set();
    try {
      const { db, STORES } = window.WorkoutDB;
      const all = await db.getAll(STORES.workouts);
      const startKey = toDateKey(start);
      const endKey = toDateKey(end);
      for (const record of all) {
        const workout = window.WorkoutModels.Workout.fromRecord(record);
        if (workout.date >= startKey && workout.date <= endKey) {
          dates.add(workout.date);
        }
      }
    } catch (err) {
      console.error('Failed to load workouts for week view', err);
    }
    return dates;
  }
}

async function initApp() {
  try {
    await window.WorkoutDB.db.open();
    await window.WorkoutDB.runMigrations(window.WorkoutDB.db);
  } catch (err) {
    console.error('Failed to initialize database', err);
  }

  try {
    currentLanguage = await window.I18n.getLanguage();
  } catch (err) {
    console.error('Failed to load language setting', err);
  }
  applyTranslations(currentLanguage);
  updateLanguageSwitchUI(currentLanguage);
  wireLanguageSwitch();

  const navController = new NavController();
  homeControllerInstance = new HomeController();
  window.WorkoutExercisesFeature.init();
  window.WorkoutStatsFeature.init();
  window.WorkoutStatsExtras.init();
  window.WorkoutDevTools.init();
  window.WorkoutBackup.init();
  window.WorkoutHistoryFeature.init({
    onChanged: () => homeControllerInstance.render(),
  });
  await window.WorkoutActiveFeature.init({
    onFinished: () => {
      navController.goTo('home');
      homeControllerInstance.render();
    },
  });

  await window.WorkoutBackup.checkReminderOnLoad();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.error('Service worker registration failed', err);
    });
  });
}

})();
