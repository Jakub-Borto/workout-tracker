'use strict';

/*
 * Workout Plans (Templates): named containers of reusable workout
 * structures (exercises, set counts, RIR/RPE targets — no metric values,
 * since templates aren't history). Starting a workout from a template
 * builds a normal draft via WorkoutRepo.saveDraft + WorkoutActiveFeature's
 * existing screen — from that point on it's indistinguishable from any
 * other in-progress draft (no origin tracking on the resulting Workout).
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

// -- Shared "can't start a new workout while one is active" conflict popup -
//
// Reusable across files (this module's own template-start flow, and the
// Home calendar's "Start the Same Workout") — a single button, no dismiss
// logic beyond closing itself.

function showActiveDraftConflict() {
  const backdrop = document.getElementById('active-draft-conflict-dialog');
  const okBtn = document.getElementById('active-draft-conflict-ok-btn');
  backdrop.hidden = false;

  return new Promise((resolve) => {
    function onOk() {
      backdrop.hidden = true;
      okBtn.removeEventListener('click', onOk);
      resolve();
    }
    okBtn.addEventListener('click', onOk);
  });
}

// -- Starting a workout from a template ------------------------------------

/**
 * Builds and saves a new draft structured after `template`, then opens the
 * normal Active Workout screen on it. No-ops (showing the shared conflict
 * popup) if a draft is already active — only one at a time, everywhere.
 * Exercises deleted since the template was created/edited are silently
 * skipped. input_1/input_1_right/input_2 are auto-filled via the same
 * logic the live "Add Set" button uses (WorkoutAutoFill.computeAutoFillValues);
 * rir/rpe come from the template's own workingSetTargets, never from
 * history. There's no gym context yet at template-start time, so lookups
 * use the General ("any gym") scope — the same default a freshly-added
 * exercise gets in any other new draft.
 */
async function startWorkoutFromTemplate(template) {
  const existingDraft = await window.WorkoutRepo.getDraft();
  if (existingDraft) {
    await showActiveDraftConflict();
    return;
  }

  const exercises = [];
  const sets = [];

  for (const entry of template.exercises) {
    const exercise = await window.WorkoutRepo.getExercise(entry.exercise_id);
    if (!exercise) continue; // deleted since the template was made — skip silently

    exercises.push(entry.exercise_id);
    const previousSets = await window.WorkoutRepo.getLastLoggedSetsForExercise(entry.exercise_id, GENERAL_GYM_ID);

    for (let i = 0; i < (entry.warmupSetCount ?? 0); i += 1) {
      const setNumber = i + 1;
      const autoFill = window.WorkoutAutoFill.computeAutoFillValues(exercise, previousSets, setNumber, true);
      sets.push({
        draft_set_id: window.WorkoutDB.generateId(),
        exercise_id: entry.exercise_id,
        set_number: setNumber,
        is_warmup_set: true,
        input_1: autoFill.input_1,
        input_1_right: autoFill.input_1_right,
        input_2: autoFill.input_2,
        rir: null,
        rpe: null,
        notes: '',
        done: false,
        gym_id: GENERAL_GYM_ID,
      });
    }

    for (let i = 0; i < (entry.workingSetCount ?? 0); i += 1) {
      const setNumber = i + 1;
      const autoFill = window.WorkoutAutoFill.computeAutoFillValues(exercise, previousSets, setNumber, false);
      const target = entry.workingSetTargets?.[i] ?? null;
      sets.push({
        draft_set_id: window.WorkoutDB.generateId(),
        exercise_id: entry.exercise_id,
        set_number: setNumber,
        is_warmup_set: false,
        input_1: autoFill.input_1,
        input_1_right: autoFill.input_1_right,
        input_2: autoFill.input_2,
        rir: exercise.effortTracking === 'rir' ? target : null,
        rpe: exercise.effortTracking === 'rpe' ? target : null,
        notes: '',
        done: false,
        gym_id: GENERAL_GYM_ID,
      });
    }
  }

  const draft = {
    name: t('workout.defaultName'),
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

// -- Home tab: "Create Workout Plan" button + plan boxes -------------------

class PlansHomeSection {
  constructor() {
    this.gridEl = document.getElementById('plans-grid');
    this.createBtn = document.getElementById('create-plan-btn');
    this.plans = [];

    this.createBtn.addEventListener('click', () => this.handleCreate());
    window.addEventListener('app:languagechange', () => this.render());
  }

  async refresh() {
    this.plans = await window.WorkoutRepo.getAllPlans();
    this.render();
  }

  async handleCreate() {
    const name = await window.WorkoutDialogs.showTextPrompt({
      title: t('plans.createPromptTitle'),
      confirmText: t('plans.createPromptConfirm'),
    });
    if (!name) return;
    await window.WorkoutRepo.createPlan({ name });
    await this.refresh();
  }

  render() {
    this.gridEl.innerHTML = '';
    this.plans
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((plan) => {
        const box = document.createElement('button');
        box.type = 'button';
        box.className = 'plan-box';
        box.textContent = plan.name;
        box.addEventListener('click', () => planBuilder.open(plan.id));
        this.gridEl.appendChild(box);
      });
  }
}

// -- Plan Builder: templates within one plan, reorder/edit/delete/rename --

class PlanBuilderController {
  constructor({ onChanged } = {}) {
    this.onChanged = onChanged ?? (() => {});

    this.overlay = document.getElementById('plan-builder-screen');
    this.closeBtn = document.getElementById('plan-builder-close-btn');
    this.addTemplateBtn = document.getElementById('plan-builder-add-template-btn');
    this.nameInput = document.getElementById('plan-builder-name-input');
    this.listEl = document.getElementById('plan-builder-template-list');
    this.emptyEl = document.getElementById('plan-builder-empty');
    this.deleteBtn = document.getElementById('plan-builder-delete-btn');

    this.plan = null;
    this.templates = [];

    this.closeBtn.addEventListener('click', () => this.close());
    this.addTemplateBtn.addEventListener('click', () => this.handleAddTemplate());
    this.nameInput.addEventListener('change', () => this.handleRename());
    this.deleteBtn.addEventListener('click', () => this.handleDeletePlan());

    window.addEventListener('app:languagechange', () => {
      if (!this.overlay.hidden) this.render();
    });
  }

  async open(planId) {
    this.plan = await window.WorkoutRepo.getPlan(planId);
    if (!this.plan) return;
    await this.refresh();
    this.overlay.hidden = false;
  }

  close() {
    this.overlay.hidden = true;
  }

  /** Re-fetches this plan's templates and self-heals workoutTemplateOrder:
   * any template no longer present is dropped, any template missing from
   * the order (just created) is appended — so callers never have to
   * remember to update the order themselves after an add/delete. */
  async refresh() {
    this.templates = await window.WorkoutRepo.getWorkoutTemplatesForPlan(this.plan.id);
    const validIds = new Set(this.templates.map((tpl) => tpl.id));
    const kept = this.plan.workoutTemplateOrder.filter((id) => validIds.has(id));
    const missing = this.templates.map((tpl) => tpl.id).filter((id) => !kept.includes(id));
    const newOrder = [...kept, ...missing];

    const changed =
      newOrder.length !== this.plan.workoutTemplateOrder.length ||
      newOrder.some((id, i) => id !== this.plan.workoutTemplateOrder[i]);
    if (changed) {
      this.plan.workoutTemplateOrder = newOrder;
      await window.WorkoutRepo.updatePlan(this.plan);
    }

    this.render();
  }

  async handleRename() {
    const name = this.nameInput.value.trim();
    if (!name) {
      this.nameInput.value = this.plan.name;
      return;
    }
    if (name === this.plan.name) return;
    this.plan.name = name;
    await window.WorkoutRepo.updatePlan(this.plan);
    this.onChanged();
  }

  handleAddTemplate() {
    templateEditor.open(this.plan.id, null, async () => {
      await this.refresh();
      this.onChanged();
    });
  }

  handleEditTemplate(templateId) {
    const template = this.templates.find((tpl) => tpl.id === templateId);
    if (!template) return;
    templateEditor.open(this.plan.id, template, async () => {
      await this.refresh();
      this.onChanged();
    });
  }

  async moveTemplate(templateId, direction) {
    const order = this.plan.workoutTemplateOrder;
    const idx = order.indexOf(templateId);
    if (idx === -1) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= order.length) return;
    [order[idx], order[newIdx]] = [order[newIdx], order[idx]];
    await window.WorkoutRepo.updatePlan(this.plan);
    this.render();
  }

  async handleDeleteTemplate(templateId) {
    const confirmed = await window.WorkoutDialogs.showConfirm({
      title: t('plans.confirmDeleteTemplateTitle'),
      message: t('plans.confirmDeleteTemplateMessage'),
      confirmText: t('common.delete'),
    });
    if (!confirmed) return;
    await window.WorkoutRepo.deleteWorkoutTemplate(templateId);
    await this.refresh();
    this.onChanged();
  }

  async handleDeletePlan() {
    const confirmed = await window.WorkoutDialogs.showConfirm({
      title: t('plans.confirmDeletePlanTitle', { name: this.plan.name }),
      message: t('plans.confirmDeletePlanMessage'),
      confirmText: t('common.delete'),
    });
    if (!confirmed) return;
    await window.WorkoutRepo.deletePlan(this.plan.id);
    this.close();
    this.onChanged();
  }

  async handleStartTemplate(templateId) {
    const template = this.templates.find((tpl) => tpl.id === templateId);
    if (!template) return;
    this.close();
    await startWorkoutFromTemplate(template);
  }

  render() {
    this.nameInput.value = this.plan.name;

    const byId = new Map(this.templates.map((tpl) => [tpl.id, tpl]));
    const orderedIds = this.plan.workoutTemplateOrder;

    this.listEl.innerHTML = '';
    this.emptyEl.hidden = orderedIds.length > 0;

    orderedIds.forEach((id, idx) => {
      const template = byId.get(id);
      if (!template) return;
      this.listEl.appendChild(this.buildTemplateRow(template, idx, orderedIds.length));
    });
  }

  buildTemplateRow(template, idx, total) {
    const row = document.createElement('div');
    row.className = 'plan-template-row';

    const nameEl = document.createElement('span');
    nameEl.className = 'plan-template-row-name';
    nameEl.textContent = template.name;

    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.className = 'icon-btn-faint icon-btn-accent';
    startBtn.setAttribute('aria-label', t('plans.startTemplate'));
    startBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 5l12 7-12 7V5z" fill="currentColor"/></svg>';
    startBtn.addEventListener('click', () => this.handleStartTemplate(template.id));

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'icon-btn-faint';
    editBtn.setAttribute('aria-label', t('plans.editTemplate'));
    editBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    editBtn.addEventListener('click', () => this.handleEditTemplate(template.id));

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'icon-btn-faint';
    upBtn.disabled = idx === 0;
    upBtn.setAttribute('aria-label', t('plans.moveUp'));
    upBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    upBtn.addEventListener('click', () => this.moveTemplate(template.id, -1));

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'icon-btn-faint';
    downBtn.disabled = idx === total - 1;
    downBtn.setAttribute('aria-label', t('plans.moveDown'));
    downBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    downBtn.addEventListener('click', () => this.moveTemplate(template.id, 1));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'icon-btn-faint icon-btn-danger';
    deleteBtn.setAttribute('aria-label', t('plans.deleteTemplate'));
    deleteBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    deleteBtn.addEventListener('click', () => this.handleDeleteTemplate(template.id));

    row.append(nameEl, startBtn, editBtn, upBtn, downBtn, deleteBtn);
    return row;
  }
}

// -- Workout Template editor: create/edit one template ---------------------

class TemplateEditorController {
  constructor() {
    this.overlay = document.getElementById('template-editor-screen');
    this.titleEl = document.getElementById('template-editor-title');
    this.cancelBtn = document.getElementById('template-editor-cancel-btn');
    this.saveBtn = document.getElementById('template-editor-save-btn');
    this.errorEl = document.getElementById('template-editor-error');
    this.nameInput = document.getElementById('template-editor-name-input');
    this.exerciseListEl = document.getElementById('template-editor-exercise-list');
    this.addExerciseBtn = document.getElementById('template-editor-add-exercise-btn');
    this.deleteBtn = document.getElementById('template-editor-delete-btn');

    this.planId = null;
    this.editingId = null;
    // Working copy while editing: [{ exercise_id, warmupSetCount, workingSetCount, workingSetTargets, _exercise }]
    this.exercises = [];
    this.onDone = null;

    this.cancelBtn.addEventListener('click', () => this.close());
    this.saveBtn.addEventListener('click', () => this.handleSave());
    this.addExerciseBtn.addEventListener('click', () => this.handleAddExercise());
    this.deleteBtn.addEventListener('click', () => this.handleDelete());

    window.addEventListener('app:languagechange', () => {
      if (!this.overlay.hidden) this.render();
    });
  }

  async open(planId, template, onDone) {
    this.planId = planId;
    this.editingId = template ? template.id : null;
    this.onDone = onDone;
    this.hideError();
    this.nameInput.value = template ? template.name : '';

    this.exercises = [];
    if (template) {
      for (const entry of template.exercises) {
        const exercise = await window.WorkoutRepo.getExercise(entry.exercise_id);
        this.exercises.push({
          exercise_id: entry.exercise_id,
          warmupSetCount: entry.warmupSetCount ?? 0,
          workingSetCount: entry.workingSetCount ?? 0,
          workingSetTargets: Array.isArray(entry.workingSetTargets) ? [...entry.workingSetTargets] : [],
          _exercise: exercise,
        });
      }
    }

    this.titleEl.dataset.i18n = template ? 'plans.templateEditor.titleEdit' : 'plans.templateEditor.titleNew';
    this.titleEl.textContent = t(this.titleEl.dataset.i18n);
    this.deleteBtn.hidden = !template;

    this.render();
    this.overlay.hidden = false;
  }

  close() {
    this.overlay.hidden = true;
  }

  showError(message) {
    this.errorEl.textContent = message;
    this.errorEl.hidden = false;
  }

  hideError() {
    this.errorEl.hidden = true;
  }

  async handleAddExercise() {
    const excludeIds = this.exercises.map((e) => e.exercise_id);
    await window.WorkoutSharedPickers.exercisePicker.open({
      excludeIds,
      titleKey: 'plans.templateEditor.pickExerciseTitle',
      onPick: async (exerciseId) => {
        const exercise = await window.WorkoutRepo.getExercise(exerciseId);
        this.exercises.push({
          exercise_id: exerciseId,
          warmupSetCount: 0,
          workingSetCount: 1,
          workingSetTargets: [],
          _exercise: exercise,
        });
        this.render();
      },
    });
  }

  handleRemoveExercise(exerciseId) {
    this.exercises = this.exercises.filter((e) => e.exercise_id !== exerciseId);
    this.render();
  }

  /** Increasing workingSetCount adds empty/unset target slots at the end;
   * decreasing truncates from the end — never discards earlier targets. */
  resizeTargets(entry) {
    const n = entry.workingSetCount;
    if (entry.workingSetTargets.length > n) entry.workingSetTargets.length = n;
    while (entry.workingSetTargets.length < n) entry.workingSetTargets.push(null);
  }

  async handleSave() {
    const name = this.nameInput.value.trim();
    if (!name) {
      this.showError(t('plans.templateEditor.errorNameRequired'));
      return;
    }
    if (this.exercises.length === 0) {
      this.showError(t('plans.templateEditor.errorNoExercises'));
      return;
    }
    this.hideError();

    const baseData = {
      plan_id: this.planId,
      name,
      exercises: this.exercises.map((e) => ({
        exercise_id: e.exercise_id,
        warmupSetCount: e.warmupSetCount,
        workingSetCount: e.workingSetCount,
        workingSetTargets: e.workingSetTargets,
      })),
    };

    if (this.editingId) {
      await window.WorkoutRepo.updateWorkoutTemplate({ ...baseData, id: this.editingId });
    } else {
      await window.WorkoutRepo.createWorkoutTemplate(baseData);
    }

    this.close();
    if (this.onDone) await this.onDone();
  }

  async handleDelete() {
    const confirmed = await window.WorkoutDialogs.showConfirm({
      title: t('plans.confirmDeleteTemplateTitle'),
      message: t('plans.confirmDeleteTemplateMessage'),
      confirmText: t('common.delete'),
    });
    if (!confirmed) return;
    await window.WorkoutRepo.deleteWorkoutTemplate(this.editingId);
    this.close();
    if (this.onDone) await this.onDone();
  }

  render() {
    this.exerciseListEl.innerHTML = '';
    this.exercises.forEach((entry) => this.exerciseListEl.appendChild(this.buildExerciseCard(entry)));
  }

  buildExerciseCard(entry) {
    const card = document.createElement('div');
    card.className = 'template-exercise-card';

    const header = document.createElement('div');
    header.className = 'template-exercise-card-header';

    const name = document.createElement('span');
    name.className = 'template-exercise-card-name';
    name.textContent = entry._exercise
      ? entry._exercise.name
      : t('plans.templateEditor.deletedExercise', { id: entry.exercise_id });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'icon-btn-faint icon-btn-danger';
    removeBtn.setAttribute('aria-label', t('plans.templateEditor.removeExercise'));
    removeBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    removeBtn.addEventListener('click', () => this.handleRemoveExercise(entry.exercise_id));

    header.append(name, removeBtn);
    card.appendChild(header);

    const countsRow = document.createElement('div');
    countsRow.className = 'template-exercise-counts-row';
    countsRow.append(
      this.buildCountField(t('plans.templateEditor.warmupSetsLabel'), entry.warmupSetCount, (value) => {
        entry.warmupSetCount = value;
        this.render();
      }),
      this.buildCountField(t('plans.templateEditor.workingSetsLabel'), entry.workingSetCount, (value) => {
        entry.workingSetCount = value;
        this.resizeTargets(entry);
        this.render();
      })
    );
    card.appendChild(countsRow);

    const effortTracking = entry._exercise?.effortTracking;
    if (effortTracking && effortTracking !== 'none' && entry.workingSetCount > 0) {
      const label = document.createElement('p');
      label.className = 'template-targets-label';
      label.textContent =
        effortTracking === 'rir' ? t('plans.templateEditor.rirTargetsLabel') : t('plans.templateEditor.rpeTargetsLabel');
      card.appendChild(label);
      card.appendChild(this.buildTargetsRow(entry, effortTracking));
    }

    return card;
  }

  buildCountField(labelText, value, onChange) {
    const wrap = document.createElement('div');
    const label = document.createElement('label');
    label.className = 'field-label';
    label.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.className = 'text-input';
    input.value = String(value);
    input.addEventListener('change', () => {
      onChange(Math.max(0, parseInt(input.value, 10) || 0));
    });
    wrap.append(label, input);
    return wrap;
  }

  buildTargetsRow(entry, effortTracking) {
    const row = document.createElement('div');
    row.className = 'template-targets-row';

    const colors = effortTracking === 'rir' ? window.WorkoutSharedPickers.RIR_COLORS : window.WorkoutSharedPickers.RPE_COLORS;
    const picker = effortTracking === 'rir' ? window.WorkoutSharedPickers.rirPicker : window.WorkoutSharedPickers.rpePicker;

    for (let i = 0; i < entry.workingSetCount; i += 1) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'set-input';
      const value = entry.workingSetTargets[i];
      btn.textContent = value ?? '';
      if (value != null && colors[value] != null) {
        btn.style.background = colors[value];
        btn.style.color = '#fff';
        btn.style.fontWeight = '700';
      }
      btn.addEventListener('click', () => {
        picker.open((picked) => {
          entry.workingSetTargets[i] = picked === '' ? null : picked;
          this.render();
        });
      });
      row.appendChild(btn);
    }

    return row;
  }
}

let plansHomeSection = null;
let planBuilder = null;
let templateEditor = null;

function init() {
  templateEditor = new TemplateEditorController();
  planBuilder = new PlanBuilderController({ onChanged: () => plansHomeSection.refresh() });
  plansHomeSection = new PlansHomeSection();
  plansHomeSection.refresh();
}

window.WorkoutPlans = { init, showActiveDraftConflict, startWorkoutFromTemplate };

})();
