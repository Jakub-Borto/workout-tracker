'use strict';

/*
 * Exercises tab: list + search/filter, and the Create/Edit Exercise overlay
 * shared by both flows. Talks to IndexedDB only through window.WorkoutRepo.
 */

(function () {

const { MUSCLE_GROUPS, MetricType, Unit, EffortTracking } = window.WorkoutModels;

function getLang() {
  return window.WorkoutI18nState ? window.WorkoutI18nState.get() : window.I18n.DEFAULT_LANGUAGE;
}

/** Toggles `id` in `selectedSet`. When exclusiveNone is true, selecting
 * 'none' clears every other selection and vice versa. */
function toggleMuscleGroup(selectedSet, id, exclusiveNone) {
  if (exclusiveNone) {
    if (id === 'none') {
      if (selectedSet.has('none')) selectedSet.delete('none');
      else {
        selectedSet.clear();
        selectedSet.add('none');
      }
    } else if (selectedSet.has(id)) {
      selectedSet.delete(id);
    } else {
      selectedSet.delete('none');
      selectedSet.add(id);
    }
  } else if (selectedSet.has(id)) {
    selectedSet.delete(id);
  } else {
    selectedSet.add(id);
  }
}

function renderChipGrid(container, ids, selectedSet, exclusiveNone, onToggle) {
  const lang = getLang();
  container.innerHTML = '';
  ids.forEach((id) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    if (selectedSet.has(id)) chip.classList.add('is-selected');
    chip.textContent = window.I18n.t(`muscleGroup.${id}`, lang);
    chip.addEventListener('click', () => onToggle(id));
    container.appendChild(chip);
  });
  // exclusiveNone param kept for callers' clarity at the call site only.
  void exclusiveNone;
}

class ExerciseEditorController {
  constructor({ onSaved, onDeleted } = {}) {
    this.onSaved = onSaved ?? (() => {});
    this.onDeleted = onDeleted ?? (() => {});

    this.overlay = document.getElementById('exercise-editor');
    this.titleEl = document.getElementById('editor-title');
    this.nameInput = document.getElementById('editor-name-input');
    this.muscleGroupsContainer = document.getElementById('editor-muscle-groups');
    this.metricTypeSelect = document.getElementById('editor-metric-type');
    this.metricUnitSelect = document.getElementById('editor-metric-unit');
    this.effortTrackingContainer = document.getElementById('editor-effort-tracking');
    this.notesInput = document.getElementById('editor-notes-input');
    this.errorEl = document.getElementById('editor-error');
    this.cancelBtn = document.getElementById('editor-cancel-btn');
    this.saveBtn = document.getElementById('editor-save-btn');
    this.deleteBtn = document.getElementById('editor-delete-btn');

    this.editingId = null;
    this.selectedMuscleGroups = new Set();
    this.effortTracking = EffortTracking.NONE;

    this.populateMetricSelects();
    this.renderMuscleGroupChips();
    this.wireEvents();
  }

  populateMetricSelects() {
    const prevType = this.metricTypeSelect.value;
    const prevUnit = this.metricUnitSelect.value;
    const lang = getLang();

    this.metricTypeSelect.innerHTML = '';
    Object.values(MetricType).forEach((type) => {
      const opt = document.createElement('option');
      opt.value = type;
      opt.textContent = window.I18n.t(`metricType.${type}`, lang);
      this.metricTypeSelect.appendChild(opt);
    });

    this.metricUnitSelect.innerHTML = '';
    Object.values(Unit).forEach((unit) => {
      const opt = document.createElement('option');
      opt.value = unit;
      opt.textContent = window.I18n.t(`unit.${unit}`, lang);
      this.metricUnitSelect.appendChild(opt);
    });

    if (prevType) this.metricTypeSelect.value = prevType;
    if (prevUnit) this.metricUnitSelect.value = prevUnit;
  }

  renderMuscleGroupChips() {
    renderChipGrid(this.muscleGroupsContainer, MUSCLE_GROUPS, this.selectedMuscleGroups, true, (id) => {
      toggleMuscleGroup(this.selectedMuscleGroups, id, true);
      this.renderMuscleGroupChips();
    });
  }

  setMetricSelectValues(metric) {
    if (metric) {
      this.metricTypeSelect.value = metric.type;
      this.metricUnitSelect.value = metric.unit;
    } else {
      this.metricTypeSelect.selectedIndex = 0;
      this.metricUnitSelect.selectedIndex = 0;
    }
  }

  setEffortTracking(value) {
    this.effortTracking = value;
    this.effortTrackingContainer.querySelectorAll('.segmented-option').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.value === value);
    });
  }

  showError(message) {
    this.errorEl.textContent = message;
    this.errorEl.hidden = false;
  }

  hideError() {
    this.errorEl.hidden = true;
  }

  open(exercise = null) {
    this.editingId = exercise ? exercise.id : null;
    this.selectedMuscleGroups = new Set(exercise ? exercise.muscleGroups : []);

    this.nameInput.value = exercise ? exercise.name : '';
    this.notesInput.value = exercise ? exercise.notes : '';

    this.setMetricSelectValues(exercise ? exercise.metric : null);

    this.setEffortTracking(exercise ? exercise.effortTracking : EffortTracking.NONE);
    this.renderMuscleGroupChips();

    this.titleEl.dataset.i18n = exercise ? 'exercise.editor.titleEdit' : 'exercise.editor.titleNew';
    this.titleEl.textContent = window.I18n.t(this.titleEl.dataset.i18n, getLang());
    this.deleteBtn.hidden = !exercise;

    this.hideError();
    this.overlay.hidden = false;
  }

  close() {
    this.overlay.hidden = true;
  }

  validate() {
    const lang = getLang();
    if (!this.nameInput.value.trim()) return window.I18n.t('exercise.editor.errorName', lang);
    if (!this.metricTypeSelect.value || !this.metricUnitSelect.value) {
      return window.I18n.t('exercise.editor.errorMetric', lang);
    }
    if (this.selectedMuscleGroups.size === 0) return window.I18n.t('exercise.editor.errorMuscleGroups', lang);
    return null;
  }

  async save() {
    const error = this.validate();
    if (error) {
      this.showError(error);
      return;
    }
    this.hideError();

    const data = {
      id: this.editingId ?? undefined,
      name: this.nameInput.value.trim(),
      muscleGroups: Array.from(this.selectedMuscleGroups),
      metric: { type: this.metricTypeSelect.value, unit: this.metricUnitSelect.value },
      effortTracking: this.effortTracking,
      notes: this.notesInput.value,
    };

    const saved = this.editingId
      ? await window.WorkoutRepo.updateExercise(data)
      : await window.WorkoutRepo.createExercise(data);

    this.close();
    this.onSaved(saved);
  }

  async delete() {
    if (!this.editingId) return;
    const id = this.editingId;
    await window.WorkoutRepo.deleteExercise(id);
    this.close();
    this.onDeleted(id);
  }

  wireEvents() {
    this.cancelBtn.addEventListener('click', () => this.close());
    this.saveBtn.addEventListener('click', () => this.save());
    this.deleteBtn.addEventListener('click', () => this.delete());

    this.effortTrackingContainer.querySelectorAll('.segmented-option').forEach((btn) => {
      btn.addEventListener('click', () => this.setEffortTracking(btn.dataset.value));
    });

    window.addEventListener('app:languagechange', () => {
      this.populateMetricSelects();
      this.renderMuscleGroupChips();
      if (!this.overlay.hidden) {
        this.titleEl.textContent = window.I18n.t(this.titleEl.dataset.i18n, getLang());
      }
    });
  }
}

/**
 * Reused as-is (different element ids, same class) by the Exercise Stats
 * picker in the Stats tab — pass `ids` to point it at a second copy of the
 * filter sheet markup instead of duplicating this logic.
 */
class MuscleFilterSheetController {
  constructor({ onApply, ids = {} } = {}) {
    this.onApply = onApply ?? (() => {});
    const {
      overlayId = 'muscle-filter-sheet',
      containerId = 'filter-muscle-groups',
      cancelBtnId = 'filter-cancel-btn',
      applyBtnId = 'filter-apply-btn',
      clearBtnId = 'filter-clear-btn',
    } = ids;
    this.overlay = document.getElementById(overlayId);
    this.container = document.getElementById(containerId);
    this.cancelBtn = document.getElementById(cancelBtnId);
    this.applyBtn = document.getElementById(applyBtnId);
    this.clearBtn = document.getElementById(clearBtnId);
    this.selected = new Set();

    this.cancelBtn.addEventListener('click', () => this.close());
    this.applyBtn.addEventListener('click', () => {
      this.onApply(new Set(this.selected));
      this.close();
    });
    this.clearBtn.addEventListener('click', () => {
      this.selected.clear();
      this.render();
    });
    window.addEventListener('app:languagechange', () => {
      if (!this.overlay.hidden) this.render();
    });
  }

  open(currentSelected) {
    this.selected = new Set(currentSelected);
    this.render();
    this.overlay.hidden = false;
  }

  close() {
    this.overlay.hidden = true;
  }

  render() {
    // Filtering is an inclusive multi-select; unlike the editor, picking
    // 'None' alongside real groups is meaningful (show both), so no
    // mutual-exclusivity rule here.
    renderChipGrid(this.container, MUSCLE_GROUPS, this.selected, false, (id) => {
      toggleMuscleGroup(this.selected, id, false);
      this.render();
    });
  }
}

/**
 * Reused as-is (different element ids, same class) by the Exercise Stats
 * picker in the Stats tab — pass `ids` to point it at a second copy of the
 * search+filter list markup instead of duplicating this logic.
 */
class ExercisesListController {
  constructor({ onOpenExercise, ids = {} } = {}) {
    this.onOpenExercise = onOpenExercise ?? (() => {});
    const {
      listId = 'exercise-list',
      emptyStateId = 'exercises-empty-state',
      noResultsStateId = 'exercises-no-results-state',
      searchInputId = 'exercise-search-input',
      clearFiltersBtnId = 'clear-filters-btn',
      filterOpenBtnId = 'muscle-filter-open-btn',
      filterBadgeId = 'muscle-filter-badge',
    } = ids;

    this.listEl = document.getElementById(listId);
    this.emptyStateEl = document.getElementById(emptyStateId);
    this.noResultsStateEl = document.getElementById(noResultsStateId);
    this.searchInput = document.getElementById(searchInputId);
    this.clearFiltersBtn = document.getElementById(clearFiltersBtnId);
    this.filterOpenBtn = document.getElementById(filterOpenBtnId);
    this.filterBadge = document.getElementById(filterBadgeId);

    this.exercises = [];
    this.searchQuery = '';
    this.selectedFilterGroups = new Set();

    this.searchInput.addEventListener('input', () => {
      this.searchQuery = this.searchInput.value;
      this.render();
    });
    this.clearFiltersBtn.addEventListener('click', () => {
      this.searchQuery = '';
      this.searchInput.value = '';
      this.selectedFilterGroups.clear();
      this.updateFilterBadge();
      this.render();
    });

    window.addEventListener('app:languagechange', () => this.render());
  }

  async refresh() {
    this.exercises = await window.WorkoutRepo.getAllExercises();
    this.render();
  }

  setFilterGroups(set) {
    this.selectedFilterGroups = set;
    this.updateFilterBadge();
    this.render();
  }

  updateFilterBadge() {
    const n = this.selectedFilterGroups.size;
    this.filterBadge.hidden = n === 0;
    this.filterBadge.textContent = String(n);
  }

  render() {
    const lang = getLang();
    const query = this.searchQuery.trim().toLowerCase();

    const filtered = this.exercises.filter((ex) => {
      const matchesName = !query || ex.name.toLowerCase().includes(query);
      const matchesGroup =
        this.selectedFilterGroups.size === 0 || ex.muscleGroups.some((g) => this.selectedFilterGroups.has(g));
      return matchesName && matchesGroup;
    });

    this.listEl.innerHTML = '';

    const hasAny = this.exercises.length > 0;
    const hasFiltered = filtered.length > 0;

    this.emptyStateEl.hidden = hasAny;
    this.noResultsStateEl.hidden = !hasAny || hasFiltered;
    this.listEl.hidden = !hasFiltered;

    if (!hasFiltered) return;

    filtered
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((ex) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'exercise-list-item';

        const name = document.createElement('span');
        name.className = 'exercise-list-item-name';
        name.textContent = ex.name;

        const groups = document.createElement('span');
        groups.className = 'exercise-list-item-groups';
        groups.textContent = ex.muscleGroups.map((g) => window.I18n.t(`muscleGroup.${g}`, lang)).join(', ');

        item.append(name, groups);
        item.addEventListener('click', () => this.onOpenExercise(ex));
        this.listEl.appendChild(item);
      });
  }
}

class GymsController {
  constructor() {
    this.overlay = document.getElementById('gyms-screen');
    this.listEl = document.getElementById('gyms-list');
    this.closeBtn = document.getElementById('gyms-close-btn');
    this.addInput = document.getElementById('gym-add-input');
    this.addBtn = document.getElementById('gym-add-btn');
    this.gyms = [];

    this.closeBtn.addEventListener('click', () => this.close());
    this.addBtn.addEventListener('click', () => this.handleAdd());
    this.addInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handleAdd();
    });
    window.addEventListener('app:languagechange', () => {
      if (!this.overlay.hidden) this.render();
    });
  }

  async open() {
    await this.refresh();
    this.addInput.value = '';
    this.overlay.hidden = false;
  }

  close() {
    this.overlay.hidden = true;
  }

  async refresh() {
    this.gyms = await window.WorkoutRepo.getAllGyms();
    this.render();
  }

  async handleAdd() {
    const name = this.addInput.value.trim();
    if (!name) return;
    await window.WorkoutRepo.createGym({ name });
    this.addInput.value = '';
    await this.refresh();
  }

  async handleDelete(gym) {
    const lang = getLang();
    const confirmed = await window.WorkoutDialogs.showConfirm({
      title: window.I18n.t('gyms.confirmDeleteTitle', lang),
      message: window.I18n.t('gyms.confirmDeleteMessage', lang, { name: gym.name }),
      confirmText: window.I18n.t('common.delete', lang),
    });
    if (!confirmed) return;
    await window.WorkoutRepo.deleteGym(gym.id);
    await this.refresh();
  }

  render() {
    const lang = getLang();
    const { GENERAL_GYM_ID } = window.WorkoutModels;

    this.listEl.innerHTML = '';
    const ordered = this.gyms.slice().sort((a, b) => {
      if (a.id === GENERAL_GYM_ID) return -1;
      if (b.id === GENERAL_GYM_ID) return 1;
      return a.name.localeCompare(b.name);
    });

    ordered.forEach((gym) => {
      const isGeneral = gym.id === GENERAL_GYM_ID;
      const row = document.createElement('div');
      row.className = 'gym-list-item';

      const name = document.createElement('span');
      name.className = 'gym-list-item-name';
      name.textContent = isGeneral ? window.I18n.t('gyms.general', lang) : gym.name;
      row.appendChild(name);

      if (!isGeneral) {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn-icon gym-list-item-delete';
        delBtn.setAttribute('aria-label', 'Delete gym');
        delBtn.innerHTML =
          '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        delBtn.addEventListener('click', () => this.handleDelete(gym));
        row.appendChild(delBtn);
      }

      this.listEl.appendChild(row);
    });
  }
}

/**
 * The Stats tab's "Exercise Stats" entry point: search/filter for an
 * exercise (same list+filter pattern as the Exercises tab, via a second
 * instance of ExercisesListController/MuscleFilterSheetController pointed
 * at this overlay's own markup), then hand off to the shared Exercise
 * History view (window.WorkoutExerciseHistory, defined in workout.js).
 */
class ExerciseStatsPickerController {
  constructor() {
    this.overlay = document.getElementById('exercise-history-picker');
    this.cancelBtn = document.getElementById('history-picker-cancel-btn');

    this.list = new ExercisesListController({
      onOpenExercise: (ex) => this.handlePick(ex),
      ids: {
        listId: 'history-picker-list',
        emptyStateId: 'history-picker-empty-state',
        noResultsStateId: 'history-picker-no-results-state',
        searchInputId: 'history-picker-search-input',
        clearFiltersBtnId: 'history-picker-clear-filters-btn',
        filterOpenBtnId: 'history-picker-filter-open-btn',
        filterBadgeId: 'history-picker-filter-badge',
      },
    });
    this.filterSheet = new MuscleFilterSheetController({
      onApply: (set) => this.list.setFilterGroups(set),
      ids: {
        overlayId: 'history-muscle-filter-sheet',
        containerId: 'history-filter-muscle-groups',
        cancelBtnId: 'history-filter-cancel-btn',
        applyBtnId: 'history-filter-apply-btn',
        clearBtnId: 'history-filter-clear-btn',
      },
    });

    this.cancelBtn.addEventListener('click', () => this.close());
    document.getElementById('history-picker-filter-open-btn').addEventListener('click', () => {
      this.filterSheet.open(this.list.selectedFilterGroups);
    });
  }

  async open() {
    await this.list.refresh();
    this.overlay.hidden = false;
  }

  close() {
    this.overlay.hidden = true;
  }

  handlePick(exercise) {
    this.close();
    window.WorkoutExerciseHistory.open(exercise.id, { initialGymId: 'all' });
  }
}

function initStatsFeature() {
  const picker = new ExerciseStatsPickerController();
  document.getElementById('open-exercise-stats-btn').addEventListener('click', () => picker.open());
  return { picker };
}

window.WorkoutStatsFeature = { init: initStatsFeature };

function initExercisesFeature() {
  const editor = new ExerciseEditorController({
    onSaved: () => list.refresh(),
    onDeleted: () => list.refresh(),
  });
  const list = new ExercisesListController({ onOpenExercise: (ex) => editor.open(ex) });
  const filterSheet = new MuscleFilterSheetController({ onApply: (set) => list.setFilterGroups(set) });
  const gyms = new GymsController();

  document.getElementById('add-exercise-btn').addEventListener('click', () => editor.open(null));
  document.getElementById('add-exercise-btn-2').addEventListener('click', () => editor.open(null));
  document.getElementById('muscle-filter-open-btn').addEventListener('click', () => {
    filterSheet.open(list.selectedFilterGroups);
  });
  document.getElementById('open-gyms-btn').addEventListener('click', () => gyms.open());

  list.refresh();

  return { editor, list, filterSheet, gyms };
}

window.WorkoutExercisesFeature = { init: initExercisesFeature };

})();
