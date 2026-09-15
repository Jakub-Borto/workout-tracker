'use strict';

/*
 * "Add Base Exercises" — Account tab action that bulk-replaces the
 * `exercises` store with a bundled starter set (English or Polish, user's
 * choice), optionally force-applying a single effort-tracking mode across
 * every one of them. Deliberately touches only the `exercises` store (via
 * db.clear + a put loop, the same primitive devtools.js's per-store Import
 * uses) rather than db.js's restoreAll, which would wipe every other store
 * too.
 */

(function () {

function getLang() {
  return window.WorkoutI18nState ? window.WorkoutI18nState.get() : window.I18n.DEFAULT_LANGUAGE;
}

function t(key, params) {
  return window.I18n.t(key, getLang(), params);
}

const FILE_BY_LANGUAGE = {
  en: 'base-exercises/exercises-en.json',
  pl: 'base-exercises/exercises-pl.json',
};

class BaseExercisesController {
  constructor() {
    this.openBtn = document.getElementById('add-base-exercises-btn');
    this.backdrop = document.getElementById('base-exercises-dialog');
    this.languageGroup = document.getElementById('base-exercises-language');
    this.effortGroup = document.getElementById('base-exercises-effort-tracking');
    this.effortWarningEl = document.getElementById('base-exercises-effort-warning');
    this.cancelBtn = document.getElementById('base-exercises-cancel-btn');
    this.confirmBtn = document.getElementById('base-exercises-confirm-btn');

    this.selectedLanguage = 'en';
    this.selectedEffortTracking = 'none';

    this.wireEvents();
  }

  wireEvents() {
    this.openBtn.addEventListener('click', () => this.open());
    this.cancelBtn.addEventListener('click', () => this.close());

    this.languageGroup.querySelectorAll('.segmented-option').forEach((btn) => {
      btn.addEventListener('click', () => this.setLanguage(btn.dataset.value));
    });
    this.effortGroup.querySelectorAll('.segmented-option').forEach((btn) => {
      btn.addEventListener('click', () => this.setEffortTracking(btn.dataset.value));
    });

    this.confirmBtn.addEventListener('click', () => this.handleConfirm());
  }

  setLanguage(value) {
    this.selectedLanguage = value;
    this.languageGroup.querySelectorAll('.segmented-option').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.value === value);
    });
  }

  setEffortTracking(value) {
    this.selectedEffortTracking = value;
    this.effortGroup.querySelectorAll('.segmented-option').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.value === value);
    });
    // RIR/RPE doesn't make sense for every base exercise (e.g. Running) —
    // this is a blunt, global override applied on confirm regardless, so
    // the warning only needs to show when that override is actually live.
    this.effortWarningEl.hidden = value === 'none';
  }

  open() {
    this.setLanguage('en');
    this.setEffortTracking('none');
    this.backdrop.hidden = false;
  }

  close() {
    this.backdrop.hidden = true;
  }

  /** Fetches the chosen language's bundled file (read-only — the file on
   * disk is never written back to), overrides effortTracking on a fresh
   * in-memory copy of each record, then fully replaces the `exercises`
   * store with the result. */
  async handleConfirm() {
    const file = FILE_BY_LANGUAGE[this.selectedLanguage];
    let sourceRecords;
    try {
      const response = await fetch(file);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = await response.json();
      // Accepts either a raw JSON array or an export-envelope file shaped
      // like devtools.js's per-store export ({ store, records: [...] }) —
      // the same two shapes handleImportFileSelected accepts, since the
      // bundled file may have been produced by exporting a real exercise
      // list rather than hand-written as a bare array.
      sourceRecords = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.records) ? parsed.records : null;
      if (!sourceRecords) throw new Error('not an array or {records: [...]}');
    } catch (err) {
      console.error('Failed to load base exercises', err);
      this.close();
      await window.WorkoutDialogs.showConfirm({
        title: t('account.baseExercisesErrorTitle'),
        message: t('account.baseExercisesFetchError'),
        confirmText: t('common.ok'),
        cancelText: '',
      });
      return;
    }

    // A fresh object per record — never mutates anything from the fetch
    // response, so the bundled base JSON's own effortTracking: "none"
    // stays exactly as shipped no matter what's chosen here.
    const records = sourceRecords.map((record) => ({ ...record, effortTracking: this.selectedEffortTracking }));

    this.close();

    const { db, STORES, migrateRecord, generateId } = window.WorkoutDB;
    await db.clear(STORES.exercises);
    for (const record of records) {
      const withId = record.id ? record : { ...record, id: generateId() };
      await db.put(STORES.exercises, migrateRecord(withId));
    }

    // Reload so every already-rendered screen (exercise list/pickers, an
    // active workout's exercise references) picks up the replaced store —
    // same reasoning as Load Sample Data / Import All Data / Wipe All Data.
    window.location.reload();
  }
}

let controller = null;

function init() {
  controller = new BaseExercisesController();
}

window.WorkoutBaseExercises = { init };

})();
