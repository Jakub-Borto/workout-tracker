# Workout Tracker — Architecture & Feature Reference

A phone-sized (≈375–430px viewport) Progressive Web App for logging gym
workouts. No frameworks, no build step — plain HTML/CSS/ES6, data lives in
IndexedDB, installable via "Add to Home Screen". This file explains what's
built and how each piece works, for picking the project back up later.

## How to ship an update

This is the checklist for **every** change that goes out, no matter how
small (a one-line CSS tweak counts) — skipping any of these steps either
means users never see the update, or they update silently with no record
of what changed.

1. **Make the code change(s).**
2. **Bump `CACHE_NAME` in `sw.js`** (e.g. `workout-tracker-v52` → `v53`).
   This is the one thing that actually makes the app update at all — the
   service worker is cache-first, so without a version bump here it just
   keeps serving the old files forever, indefinitely, to every user,
   regardless of what changed in the actual source files. If a new file
   was added, also add it to the `APP_SHELL` array in `sw.js` so it gets
   precached (see "Service worker updates" below for the full mechanism —
   updates install safely in the background and never interrupt an active
   workout).
3. **Add a matching entry to `changelog.js`** — same exact version string
   as the `CACHE_NAME` you just set, as the `version` field, plus a `date`
   and a `changes` array of short, plain, user-facing bullet points (what
   changed from the user's point of view, not implementation detail). This
   is what powers the in-app "What's New" popup — an update with no
   changelog entry still installs fine, but the popup will just show
   nothing useful for that version. **Do this for every change, including
   pure bug fixes — not just new features.**
4. **Commit and push to `main`.** GitHub Pages serves directly from the
   repo, so pushing *is* the deploy step — there's no separate build/deploy
   pipeline. Only commit/push when the user actually asks for it.
5. Users pick up the update automatically the next time they open the app
   (checked in the background, activated once it's safe — see "Service
   worker updates"), or immediately via the Account tab's "Check for
   Updates" button. No manual cache-clearing should ever be necessary for
   a real user — that's only ever been a *local dev-server* workaround
   (see below), never something to tell an actual user to do.

## Local development

```
python -m http.server 8149
```
then open `http://localhost:8149` (the actual port in `.claude/launch.json`
has been bumped many times since, purely because of a caching quirk in one
preview tool: after enough reuse — sometimes within the same session — it
starts serving a stale `<script src>` load for a JS file even with Cache
Storage cleared, the service worker unregistered, and a brand-new tab,
while a runtime `fetch('/file.js', { cache: 'no-store' })` from the same
page gets the current content. Nothing to do with the app itself; if a code
change doesn't seem to take effect, verify with that fetch trick first, and
if it confirms stale content, just bump the port again rather than
debugging the app.

## File map

| File | Responsibility |
|---|---|
| `index.html` | All markup: the 5 tab screens, every overlay/dialog, `<script>` load order |
| `style.css` | All styling. Dark theme, CSS variables in `:root` |
| `db.js` | IndexedDB wrapper (`Database` class), store names, schema version, migrations |
| `models.js` | Plain data classes: `Exercise`, `WorkoutSet`, `Workout`, `ExerciseNote`, `BodyweightEntry`, `Gym`, `PersonalRecord`, `Plan`, `WorkoutTemplate` |
| `repository.js` | `window.WorkoutRepo` — all CRUD + cross-store queries. The only thing that talks to `db.js` directly (besides Dev Tools) |
| `i18n.js` | `window.I18n` — EN/PL string table + `t(key, lang, params)` with `{param}` interpolation |
| `app.js` | Bootstraps the app: opens the DB, runs migrations, wires bottom nav, renders the Home tab's weekly calendar |
| `exercises.js` | Exercises tab (list/search/filter), Create/Edit Exercise overlay, Gyms management screen, the Stats tab's "Exercise Stats" picker |
| `workout.js` | The big one: Active Workout screen, the draft-workout system, Workout Detail (edit history) screen, every shared popup (exercise picker, note editor, RIR/RPE pickers, gym picker, PR dialog, Exercise History, generic confirm), and the shared SVG chart module (`window.WorkoutCharts`) |
| `stats.js` | The Stats tab's shared date-range selector plus its four stats categories (Muscle Group / Workout / Exercise Rankings / Personal Records) — distinct from `exercises.js`'s "Exercise Stats" entry point above |
| `devtools.js` | Dev Tools screen: raw view into every IndexedDB store, wipe/delete with type-to-confirm |
| `backup.js` | Account tab: one-tap full-database Export/Import (all stores in one file) |
| `plans.js` | Workout Plans: Plan/WorkoutTemplate CRUD UI (Home tab boxes, Plan Builder, template editor), starting a workout from a template, the shared one-active-draft conflict popup |
| `calendar.js` | Home tab's workout-dot tap: the View/Start-Same/Add-to-Plan choice popup and the plan picker |
| `changelog.js` | Hand-maintained release notes array (`version` must match `sw.js`'s `CACHE_NAME`), `getEntriesBetween` lookup |
| `updates.js` | Service worker registration, the update-check/status-indicator flow, the safe-activation handshake, and the "what's new" popup |
| `sw.js` | Service worker: cache-first app shell, versioned by `CACHE_NAME`, the install/activate/message handlers half of the safe-activation handshake (see `updates.js`) |
| `manifest.json` | PWA manifest (icons, standalone display, portrait lock) |

Every JS file wraps its body in `(function () { ... })();` — needed because
the preview tooling used during development could re-evaluate a `<script>`
in the same JS context and throw false "already declared" errors otherwise.

## Data model (`models.js`)

Every record has a `schemaVersion` field. Readers use `field ?? default`,
never assume a field exists — this is what lets old records loaded from a
previous version of the app keep working after new fields are added.

- **`Exercise`** — `{ id, name, muscleGroups[], metric: {type, unit}, effortTracking, notes, schemaVersion }`.
  `metric.type` drives Input 1 on the workout screen (e.g. reps, meters),
  `metric.unit` drives Input 2 and is only shown when the unit isn't `'none'`
  (e.g. kg). `effortTracking` is `'none' | 'rir' | 'rpe'`, mutually exclusive.
  `MetricType.REPS_PER_SIDE` is special-cased throughout the workout screens
  (see below) to split Input 1 into two boxes instead of one.
- **`WorkoutSet`** — one logged set: `{ set_id, exercise_id, workout_id, set_number, is_warmup_set, input_1, input_1_right, input_2, rir, rpe, notes, gym_id, schemaVersion }`.
  Warm-up and working sets number independently (both start at 1). `input_1`
  is the Left side's value when `metric.type` is `'reps_per_side'`;
  `input_1_right` is the Right side's value and is otherwise unused/null.
- **`Workout`** — a *finished* workout only: `{ id, name, date, exerciseOrder: string[], schemaVersion }`.
  No start time — that only exists in the in-progress draft (see below).
  `exerciseOrder` is the exercise_ids in display order (see Move buttons).
- **`ExerciseNote`** — a carry-forward note tied to one exercise+workout pair:
  `{ id, exercise_id, workout_id, text, schemaVersion }`. Full history kept —
  never overwritten, one record per exercise per workout.
- **`Gym`** — `{ id, name, schemaVersion }`. `GENERAL_GYM_ID = 'general'` is a
  fixed sentinel id, always present, never deletable/renamable by the user.
- **`PersonalRecord`** — a hand-marked PR snapshot: `{ id, exercise_id, gym_id, date, sets: [...], schemaVersion }`.
  Append-only history: every PR ever marked is kept (random `id`, like other
  records), marking again never overwrites an earlier one. `WorkoutRepo.getPRHistory(exerciseId, gymId)`
  returns all of them for an exercise (newest first); `getLatestPR(exerciseId, gymId, beforeDate)`
  returns just the most recent one for an exact exercise+gym pair (what the
  in-workout PR dialog shows as "current best") — `beforeDate` is optional
  and, when given, excludes any PR dated on or after it.
- **`BodyweightEntry`** — `{ id, date, weight, schemaVersion }` (tab exists,
  feature not built yet).
- **`Plan`** — `{ id, name, workoutTemplateOrder: string[], schemaVersion }`.
- **`WorkoutTemplate`** — a reusable workout *structure* (never becomes a
  `Workout`/`WorkoutSet` by itself): `{ id, plan_id, name, exercises: [{ exercise_id, warmupSetCount, workingSetCount, workingSetTargets }], schemaVersion }`.
  No metric values (target reps/weight/time) by design — only structure and
  RIR/RPE targets. See "Workout Plans" under Screens & features below.

## IndexedDB (`db.js`)

Database name `workout-tracker`, currently version 6. Stores:

| Store | keyPath | Notes |
|---|---|---|
| `exercises` | `id` | indexed by `name` |
| `workouts` | `id` | indexed by `date`, finished workouts only |
| `sets` | `set_id` | indexed by `workout_id`, `exercise_id` |
| `exerciseNotes` | `id` | indexed by `exercise_id`, `workout_id` |
| `draftWorkout` | `id` | single record, fixed id `'current'` |
| `bodyweights` | `id` | indexed by `date` |
| `gyms` | `id` | seeded with the General gym on first load |
| `personalRecords` | `id` | random id per entry (append-only history, not upserted), no index needed |
| `settings` | `key` | single record `'app'`, holds language + schema version |
| `plans` | `id` | |
| `workoutTemplates` | `id` | indexed by `plan_id` |

`runMigrations()` runs on every app start: bumps the stored schema version
if needed, and seeds the General gym if it's missing (covers both fresh
installs and upgrades from a version before gyms existed).

## Screens & features

### Home tab
Weekly calendar (Mon–Sun), dot under any day with a finished workout.
Tapping a day with a dot opens a 3-option choice popup (see "Calendar dot
choice popup" below) instead of going straight to Workout Detail.
"Start Empty Workout" begins/resumes the draft. Below the calendar: the
Workout Plans section (see below).

### Calendar dot choice popup — `calendar.js`
Tapping a workout dot opens `#workout-dot-choice-dialog` (View Workout /
Start the Same Workout / Add to Plan / Cancel) via `window.WorkoutDotChoice.open(workoutId)`,
called from `HomeController.handleDayTap` in `app.js`. The dialog shows the
workout's name and date (`showChoiceDialog(workout)`) so it's clear which
workout you're about to act on before picking an option. The popup hides
itself *before* resolving its promise (in `showChoiceDialog`'s `cleanup`),
so whichever follow-up popup a choice triggers (the conflict dialog, the
plan picker) never overlaps it — only one popup visible at a time, same
rule as everywhere else in the app.

- **View Workout** — unchanged, just `window.WorkoutHistoryFeature.open(workoutId)`.
- **Start the Same Workout** / **Add to Plan** both start from
  `deriveStructureFromWorkout(workout)`: the workout's actual exercises in
  `exerciseOrder` (falling back to alphabetical for exercises not in it —
  same convention Workout Detail uses for pre-`exerciseOrder` workouts) with
  warm-up/working set *counts* re-derived by counting its real `WorkoutSet`
  records (`getSetsForWorkout`, grouped by exercise + `is_warmup_set`) —
  never anything from `Workout`/`WorkoutSet` beyond that, and an exercise
  deleted since is silently absent from the result.
  - **Start the Same Workout**: builds a draft with that exact structure;
    `input_1`/`input_1_right`/`input_2` are auto-filled the same way the
    live "Add Set" button and Plans' "start from template" both do
    (`WorkoutAutoFill.computeAutoFillValues`, matched against whatever was
    most recently logged — not necessarily `workout` itself). `rir`/`rpe`
    stay `null` — unlike a Plan template there's no target value to seed
    them with here. (Earlier revision left every field blank with no
    auto-fill at all; changed after testing showed the auto-fill was
    expected here too, matching the same "logic" used everywhere else new
    sets get created.) Reuses the exact same one-active-draft conflict
    popup as Plans (`window.WorkoutPlans.showActiveDraftConflict`) and the
    same `WorkoutRepo.saveDraft` + `WorkoutActiveFeature.openExisting()` pattern.
  - **Add to Plan**: a lightweight plan picker (`showPlanPicker`,
    `#plan-picker-dialog`, list styling reused from the gym/exercise picker
    patterns) — if no plans exist, shows a message pointing at the Home
    tab's "Create Workout Plan" button instead of an empty list. Converts
    the structure into a new `WorkoutTemplate` (named after the workout)
    appended to the chosen plan's `workoutTemplateOrder`, with every
    `workingSetTargets` entry left `null` for effort-tracked exercises — a
    finished `WorkoutSet` only has what was actually logged, never an
    intended target, so there's nothing to seed them with; the user fills
    targets in afterward via the normal Plan Builder edit flow. Ends with a
    plain confirm-style "Added to Plan" acknowledgement (`showConfirm` with
    `cancelText: ''`), the same OK-only feedback pattern used elsewhere for
    a completed save-type action.

### Workout Plans (Templates) — `plans.js`
A `Plan` (`plans` store) is a named container of `WorkoutTemplate`s
(`workoutTemplates` store, indexed by `plan_id`) — reusable workout
*structures* (exercises, set counts, per-working-set RIR/RPE targets), never
actual logged values, since templates aren't history. Both stores follow
the exact same id-keyed/schemaVersion-having pattern as every other store,
so Dev Tools and Full Backup Export/Import/Restore pick them up completely
for free — no plan-specific code exists in `devtools.js` or `backup.js`/`db.js`.

```js
// Plan
{ id, name, workoutTemplateOrder: [templateId, ...], schemaVersion }

// WorkoutTemplate
{ id, plan_id, name, schemaVersion,
  exercises: [{ exercise_id, warmupSetCount, workingSetCount,
                workingSetTargets }] }  // one RIR/RPE target per working
                                        // set, only used when the exercise's
                                        // effortTracking isn't 'none'
```

**Home tab**: "Create Workout Plan" button (`PlansHomeSection`) prompts for
a name via a new generic single-field dialog (`window.WorkoutDialogs.showTextPrompt`,
`#text-prompt-dialog` — same modal-card pattern as the Finish Workout date
dialog) and creates the `Plan`. Each plan renders as a tappable box in a
2-column grid below the calendar; tapping one opens the Plan Builder.

**Plan Builder** (`PlanBuilderController`, `#plan-builder-screen`): the
plan's name is an inline-editable input that saves on `change` (same
convention as Workout Detail's own name field) — this is how a plan gets
renamed, no separate rename prompt. Lists its templates in
`workoutTemplateOrder`, each with edit/move-up/move-down/delete icon
buttons; a "Delete Plan" button at the bottom cascades to every template in
it (`WorkoutRepo.deletePlan`, same "delete the container, delete its
children" convention as `deleteWorkout`→sets/notes). `refresh()` is
self-healing: it re-fetches this plan's templates and reconciles
`workoutTemplateOrder` against what actually exists (drops stale ids,
appends missing ones) every time, so neither the add-template nor
delete-template path has to remember to touch the order array itself.

**Template editor** (`TemplateEditorController`, `#template-editor-screen`):
name field, per-exercise cards (warm-up count / working count / one
RIR-or-RPE target button per working set, only shown when the exercise's
`effortTracking` isn't `'none'`). "Add Exercise" reuses the shared
`ExercisePickerController` instance directly — `sharedExercisePicker`,
`sharedRirPicker`, `sharedRpePicker` (plus their `RIR_COLORS`/`RPE_COLORS`
maps) are exposed cross-file via `window.WorkoutSharedPickers` specifically
so `plans.js` can call the exact same singletons `workout.js` already binds
to `#exercise-picker`/`#rir-picker`/`#rpe-picker`, rather than constructing
second instances that would double-bind those shared overlays' click
handlers (see "Shared singleton overlays" below). Changing a working-set
count resizes `workingSetTargets` non-destructively — growing appends
empty slots at the end, shrinking truncates from the end — so already-set
earlier targets are never silently discarded.

**Starting a workout from a template** (`startWorkoutFromTemplate`, called
both from tapping a template row and — in a later segment — the Home
calendar's "Start the Same Workout"): only proceeds if
`WorkoutRepo.getDraft()` is empty; otherwise shows the shared **conflict
popup** (`showActiveDraftConflict`, `#active-draft-conflict-dialog`, single
"Go to Home" dismiss button — deliberately built as one reusable exported
function rather than embedded inline, since it's needed from more than one
file). Builds a full draft object matching the normal draft shape exactly
(same fields `startOrResume` uses), then `WorkoutRepo.saveDraft` +
`window.WorkoutActiveFeature.openExisting()` (a small new export that just
opens the active-workout screen on whatever draft is currently saved —
reused rather than duplicating screen-opening logic). Per exercise: skips
it silently if it's been deleted since the template was made; new sets'
`input_1`/`input_1_right`/`input_2` come from `WorkoutAutoFill.computeAutoFillValues`
(see above) using the General/"any gym" scope, since there's no gym context
yet at template-start time (same default a freshly-added exercise gets in
any new draft); `rir`/`rpe` come from the template's own
`workingSetTargets`, never from history. **Critical constraint, deliberately
enforced by omission**: nothing about the resulting draft — and therefore
nothing about the `Workout`/`WorkoutSet` records once it's finished — records
which template/plan it came from. A workout started from a template is
byte-for-byte indistinguishable from one started via "Start Empty Workout"
once finished.

### Exercises tab
Search + muscle-group filter over the exercise library. "+" opens the
Create/Edit Exercise overlay (name, muscle groups, metric type/unit,
effort tracking, notes). The pill button labeled **Gyms** opens gym
management: General is pinned at top and locked, custom gyms can be
added and deleted (deleting one falls its already-logged sets back to
General rather than orphaning them — see `WorkoutRepo.deleteGym`).

### Active Workout (in-progress) — the draft system
Nothing touches the permanent `workouts`/`sets`/`exerciseNotes` stores while
a workout is in progress. Everything lives in one draft object in the
`draftWorkout` store (`WorkoutRepo.getDraft/saveDraft/deleteDraft`):

```js
{
  name, date, startedAt,
  exercises: [exerciseId, ...],       // display order
  activeExerciseId,
  sets: [{ draft_set_id, exercise_id, set_number, is_warmup_set,
           input_1, input_1_right, input_2, rir, rpe, notes, done, gym_id }],
  exerciseNotes: { [exerciseId]: text },
  gymByExercise: { [exerciseId]: gymId },  // which gym new sets use
  countdown: { remainingSeconds, running, targetEndAt },
}
```

"Finish Workout" (`WorkoutRepo.finishDraftWorkout`) is the only point this
becomes real: creates a `Workout` (with `exerciseOrder: draft.exercises`),
one `WorkoutSet` per set marked `done` (incomplete ones are dropped, with a
warning first), and one `ExerciseNote` per exercise with note text — then
deletes the draft. "Discard" just deletes the draft outright. A draft older
than 24h shows an expiry warning on app load (`checkExpiryOnLoad`) asking
whether to pick up where you left off; choosing yes just opens the normal
active-workout screen on that draft (`openExisting`) rather than silently
auto-finishing it behind the scenes, so incomplete sets and the finish date
still go through the regular Finish Workout flow above. Choosing no deletes
the draft.

**Auto-fill new sets from previous workout** (`window.WorkoutAutoFill.computeAutoFillValues`
in `workout.js`): whenever a brand-new set is added via the live "Add
Set"/"Add Warmup" buttons, its `input_1`/`input_1_right`/`input_2` start
out pre-filled rather than blank. Matched by exercise + set number +
warmup/working status against `WorkoutRepo.getLastLoggedSetsForExercise`
(gym-filtered the same way the "Previous" column already is). Warm-up sets
are copied exactly; working sets get `input_1`/`input_1_right` +1 when the
exercise's metric type is `'reps'`/`'reps_per_side'` (the only types where
"one more rep than last time" makes sense) — `input_2` (e.g. weight) is
never auto-incremented, only copied, since progression there is a
deliberate user call. No match (first time ever, or a new set number never
logged before) leaves every field empty, same as the old baseline
behavior. This is a pure function taking the exercise + previous sets +
set number/warmup flag — no DB access itself — so it's reused as-is by
Workout Plans' "start from template" flow (see below) rather than being
reimplemented there. Deliberately does **not** apply to Workout Detail's
own "add set while editing a finished workout" (`newLocalSet`) — editing
history stays manual/unchanged.

Minimizing (chevron button) hides the screen without touching the draft —
you can resume from the "Come back to workout" bar on Home.

### Workout Detail (editing a finished workout)
Opened from the Home calendar. Unlike the active screen, **nothing is
auto-saved**: `WorkoutDetailController` loads the real records into local
working-copy fields (`this.sets`, `this.exerciseNotes`, `this.name`,
`this.date`, `this.gymByExercise`, `this.exerciseIds`) on `open()`, and every
edit (typing a value, adding/removing/swapping an exercise, changing gym,
reordering) mutates only those local copies. Minimizing/closing discards
everything. Only **Save** (`persist()`) diffs local vs. original and writes
to IndexedDB; it warns and drops incomplete sets first, same as Finish
Workout. **Delete** removes the whole workout (cascades to its sets and
notes via `WorkoutRepo.deleteWorkout`).

Exercise display order comes from `Workout.exerciseOrder`; workouts saved
before that field existed fall back to alphabetical order.

### Gyms & the "Previous" column
A gym is not necessarily a location — **General** is a deliberate
"ignore gym" filter (good for free weights/bodyweight, same numbers
anywhere), while a custom gym (e.g. "RMG Kielce") filters to only that
location's history. Each exercise-in-workout has its own selected gym
(`Gym: X` button in the action row, opens `GymPickerController`); new sets
you add are stamped with that `gym_id`. The **Previous** table column and
the "last logged sets" lookup respect this: `WorkoutRepo.getLastLoggedSetsForExercise(exerciseId, gymId)`
and `getPreviousLoggedSetsForExercise(exerciseId, excludeWorkoutId, gymId)`
filter to sets with that same `gym_id` unless `gymId` is General, in which
case they ignore gym entirely and return the most recent set regardless.

### Personal Records (PR)
Hand-marked, never computed automatically. The **PR** button in the action
row opens a popup (shared `PRDialogController`) showing the last saved PR
for that exercise **at the currently selected gym** — full snapshot: every
set's reps/weight and RIR/RPE, warm-ups included, plus the date it was
marked. **Mark as PR** snapshots every set currently logged for that
exercise in this workout and appends it via `WorkoutRepo.createPR({exercise_id,
gym_id, date, sets})` — every PR ever marked is kept (see the data model
section above), never overwritten. Confirming shows a generic confirm
dialog first (only one popup ever visible at a time — the PR popup hides
itself while the confirm is up); confirming closes both dialogs, cancelling
returns you to the PR popup unchanged.

**No look-ahead bias when reviewing history**: opening the PR dialog from
Workout Detail (editing an old, already-dated workout) passes that
workout's own date as `beforeDate`, so "current best" only considers PRs
that actually stood *before* that date — never one marked later (including
one marked during that same workout, on the same date, which is excluded
too since the cutoff is strict `<`). Opening it from Active Workout passes
no cutoff, since there's nothing to look ahead of.

### Move exercise (left/right)
Two chevron icon buttons in the action row reorder the exercise within the
workout — disabled at whichever end is already reached. In the active
workout this reorders `draft.exercises` directly (persisted immediately).
In Workout Detail it reorders the local `this.exerciseIds`, persisted to
`Workout.exerciseOrder` only on Save.

### Exercise History (Stats tab + Active Workout entry point)
A read-only drill-in into every set ever logged for one exercise, shared
between two entry points via the same shared-singleton pattern as the other
popups (`sharedExerciseHistory` in `workout.js`, exposed as
`window.WorkoutExerciseHistory.open(exerciseId, { initialGymId })`):

- **Stats tab** — "Exercise Stats" opens a picker (`ExerciseStatsPickerController`
  in `exercises.js`) reusing `ExercisesListController`/`MuscleFilterSheetController`
  pointed at a second copy of their markup via a new `ids` constructor option
  (both classes default to the original Exercises-tab element ids when `ids`
  is omitted, so that call site is unchanged). Picking an exercise opens the
  history defaulting to the **All** gym filter.
- **Active Workout action row** — a **History** button opens the same view
  directly for the exercise being viewed, defaulting the gym filter to
  whatever gym is currently selected for it in the draft
  (`draft.gymByExercise[exerciseId]`), falling back to All if that's General
  or a gym that no longer exists (General isn't a selectable filter here).

Inside the view: gym filter chips are **All** plus one per *custom* gym only
— General is deliberately excluded as a filter option in this screen, and
unlike the "Previous" column's convention, each gym chip (including how All
behaves) is a plain literal filter with no special-casing. This filter
applies across all three sub-views below (a segmented `History / PR / Chart`
tab row at the top of the screen, `this.viewMode` in `ExerciseHistoryController`).

`WorkoutRepo.getExerciseHistory(exerciseId)` fetches every set for the
exercise once, grouped by workout and sorted newest-date-first, each group's
sets pre-sorted warm-up-first; the controller re-filters that cached list
client-side per gym-chip click rather than re-querying (`getVisibleGroups()`).
Two distinct empty states throughout: no data at all for the exercise, vs.
data exists but none matches the selected gym filter. Purely a browser — no
navigation to Workout Detail, no editing.

- **History tab** (default) — the original feature: date-labeled clusters of
  every logged set, newest first. Each set row uses `formatSetSummary(exercise, set)`
  (the same helper the PR dialog uses) so Input 1 / Input 2 / RIR-or-RPE
  display rules stay identical everywhere.
- **PR tab** — every `PersonalRecord` ever marked for the exercise (via
  `WorkoutRepo.getPRHistory`), newest first, each showing its date and full
  set snapshot; when the gym filter is "All", each entry also shows which
  gym it was marked at (dropped when filtered to one gym, since it'd be
  redundant with the selected chip).
- **Chart tab** — one point per workout, x-axis chronological (oldest→newest,
  the one place in this screen that isn't newest-first), y-axis the "key
  value" of that workout's best non-warmup set for the exercise
  (`chartValueForSet`: the unit value when there is one, e.g. kg, else the
  type value, e.g. reps/meters/seconds — same heuristic the sample-data
  generator's PR picker uses). Hand-rolled inline SVG (no charting library,
  consistent with the rest of the app) — a single accent-colored line +
  dots, defaulting its caption to the most recent point, tap any dot to see
  its date/value instead (`buildChart` in `workout.js`).

### Dev Tools (Account tab)
Read-only JSON dump of every IndexedDB store, collapsible per store, with
per-store **Export**, **Import**, and **Delete** buttons plus a "Wipe All
Data" button. Delete and Wipe All require typing a random 6-character code
shown on screen (`showDangerConfirm`) — a stronger confirmation than the
generic Yes/No dialog used everywhere else, since they're irreversible and
destroy data. Import is only additive/overwriting (an upsert via `db.put`),
never deletes anything, so it uses the plain `showConfirm` instead.

**Export** downloads that store's records as `{ store, exportedAt,
schemaVersion, records }` JSON. A plain `<a download>` click is unreliable
as an installed PWA — an installed iOS app runs in a standalone webview
with no browser chrome to catch a download, and Android's installed/TWA
mode can be similarly inconsistent — so `handleExportStore` tries
`navigator.share({ files: [...] })` first (the native share sheet, which
can Save to Files/Drive/etc., and is what both iOS 15+ and Android Chrome
actually support reliably for this) and only falls back to the anchor
download when `navigator.canShare({ files })` isn't available (typically
desktop browsers, which support the plain download fine since there's no
standalone-shell restriction).

**Import** uses a single hidden `<input type="file">` shared by every
store's Import button (`this.importInput`, created once in the
`DevToolsController` constructor); which store a picked file targets is
tracked in `this.importTarget` between the click and the file input's async
`change` event. Standard file inputs work the same in an installed PWA as
in a regular tab on both iOS and Android, so no fallback is needed there.
Accepts either a raw JSON array of records or a full export file (reads its
`records` array); an invalid/unparseable file shows an OK-only dialog
(`showConfirm` with `cancelText: ''`) rather than a native `alert()`.

**Load Sample Data** button (`devtools-load-sample-data-btn`,
`handleLoadSampleData`) fetches `sample-data/full-backup-sample.json` — a
full-backup-shaped file bundled with the app (same shape as `backup.js`'s
Export All Data output; listed in `sw.js`'s precache list so it works
offline too) — and restores it via `db.restoreAll()`, the same full-replace
path Import All Data uses. Same missing-store validity check as a real
backup restore (rejects if any known store isn't present as an array in the
file, listing which ones). A one-tap way to get the app into a known,
repeatable state for testing without needing to export/import manually.

### Full Backup (Account tab, `backup.js`)
Two buttons — **Export All Data** / **Import All Data** — for a normal user
to back up or restore everything with one tap, without ever opening Dev
Tools. Built on `Database.exportAll()`/`importAll()` in `db.js` (already
existed, previously unused): `exportAll` dumps every store keyed by store
name into one `{ schemaVersion, exportedAt, <storeName>: [...], ... }`
object; `importAll` iterates every known store name in that object and
`db.put`s each record through `migrateRecord`.

Export reuses the same share-sheet-first/anchor-download-fallback as Dev
Tools' per-store export (see above) — same reasoning applies since this is
also invoked from an installed PWA. The downloaded filename is
`workout-tracker-backup-<yyyy-mm-dd>.json`.

Import is a full **restore**, not an upsert like Dev Tools' per-store
import: `Database.restoreAll()` in `db.js` clears every store first, then
runs `importAll` — so the database ends up an exact match for the backup,
and anything created/changed since the backup was taken is gone (a plain
upsert would silently leave newer data in place, which isn't what "restore
this backup" means to a user). The confirm dialog states this destructive
replace explicitly. Unlike Dev Tools' per-store validity check (accepts if
*any* known store is present), a restore validates that *every* known
`WorkoutDB.STORES` name is present as an array in the parsed JSON before
touching anything — a file missing even one store is rejected outright with
the missing names listed, since a partial file would otherwise silently wipe
stores it doesn't account for. After a successful import the page does a
full `location.reload()`, since a restore can change the active/current
draft workout, settings, and every other piece of state several controllers
cached at startup — simplest to just reload rather than re-init every
controller in place.

### Backup reminder (Account tab, `backup.js`)
Since this app has no server/account system, a manual "Export All Data" is
the user's only real protection against data loss — this is a nag, not a
real backup mechanism, to keep that from being forgotten. Tracked via two
fields on the `settings` store's `'app'` record:
- `lastBackupAt` — set only by a successful **Export All Data** (never by
  Dev Tools' per-store export, which is a separate debugging-oriented tool
  this reminder isn't trying to encourage). Seeded to "now" the first time
  it's missing (`runMigrations` in `db.js`) — covers both a fresh install
  (nothing worth backing up yet) and upgrading from a version before this
  field existed — so nobody is nagged immediately on first launch/upgrade.
- `lastBackupReminderDismissedAt` — set whenever the reminder popup is
  snoozed ("Remind Me Later"), whether or not an export happened. Kept
  separate from `lastBackupAt` deliberately: snoozing and actually backing
  up are different facts, and conflating them would make a stale "last
  backup was N days ago" claim (if this app ever surfaces one) a lie.

`checkReminderOnLoad` runs once per app load, right after
`WorkoutActiveFeature.init` (same "check on open, not on a timer" pattern as
the draft's `checkExpiryOnLoad`). It compares "now" against whichever of the
two fields is more recent; if that's more than 14 days ago, it shows the
same generic `showConfirm` modal used everywhere else in the app, with
"Export Now" / "Remind Me Later" as the two actions. "Export Now" calls
`handleExport()` directly (no duplicated export logic) — success naturally
updates `lastBackupAt` and thus resets the reminder clock. "Remind Me Later"
just bumps `lastBackupReminderDismissedAt`, buying another 14 days without
pretending a backup happened.

### Input auto-formatting
`sanitizeInputValue(raw, format)` in `workout.js` — `'natural'` (digits
only), `'rational'` (digits + one decimal point), or `'time'` (digit-only
mask inserting `:` once >2 digits are typed, e.g. `"125"` → `"1:25"`).
Which format applies to Input 1 / Input 2 is driven by the exercise's
metric type/unit (`INPUT_FORMAT_BY_TYPE` / `INPUT_FORMAT_BY_UNIT`).
**Important**: formatting is applied only on the `change` event (blur/Enter),
never on `input` — live re-masking on every keystroke previously broke
typing on mobile virtual keyboards.

RIR is picked from a fixed 0–6+ scale via a color-coded popup
(`RirPickerController`, red→blue gradient), never free-typed. RPE gets the
same treatment via `RpePickerController`: a fixed 1–10 scale, blue (1,
easiest) through red (10, max effort) — the gradient runs the opposite
direction from RIR's since the two scales are inverted (low RIR = hard,
high RPE = hard), but red always means "hardest" either way. Both pickers
follow the shared-singleton pattern (`sharedRirPicker` / `sharedRpePicker`)
and are wired into `buildRirCell`/`buildRpeCell` in both workout screens,
chosen by `exercise.effortTracking`.

### Reps-per-side exercises (L/R split)
When `exercise.metric.type === 'reps_per_side'`, both `buildSetTable`
implementations (Active Workout and Workout Detail — duplicated, not
shared) render **two** Input 1 boxes instead of one: `input_1` labeled
`t('workout.sideLeft')` ("L" in both languages) and the new `input_1_right`
field labeled `t('workout.sideRight')` ("R" in English, "P" — Prawa — in
Polish), each formatted as `'natural'` regardless of `INPUT_FORMAT_BY_TYPE`.
`formatSetSummary(exercise, set)` — the one function shared by the
"Previous" column, the PR dialog, and Exercise History — renders these as
`"L 8 / R 6"` so every read-only display of a per-side set stays consistent
without each caller re-implementing the split. There's no schema flag
beyond `metric.type`; `input_1_right` is simply null/unused for every other
metric type.

### Stats tab: shared date range + per-stat screens (`stats.js`)
Separate from `exercises.js`'s "Exercise Stats" entry point (which opens the
per-exercise History/PR/Chart view, unchanged by this). Rather than one long
scrolling page, each stat gets its own button on the Stats tab — the same
`settings-row settings-row-link` pattern "Exercise Stats" already uses —
opening a dedicated full-screen overlay. All of them share one date-range
selector (`StatsRangeController`) and recompute live from `WorkoutRepo`
every time a screen is opened or the range changes; nothing here is ever
persisted.

**Date range** (`#stats-range-picker`) — This Week / This Month / This Year
/ All Time (resolves its start date via `WorkoutRepo.getEarliestWorkoutDate()`)
/ Last X Days (30/90/182/365 chips + a custom number input) / a **Custom
Range** with explicit start+end date inputs, both inclusive (called out in
the UI so it isn't ambiguous: `stats.customRangeInclusiveNote`).
`resolveDates()` turns the selection into inclusive `{startDate, endDate}`
ISO strings; `weeksInRange()`/`daysBetweenInclusive()` give every stat a
sensible denominator even for partial ranges (e.g. "This Week" on a
Wednesday is treated as its true ~3/7 of a week, never rounded to 0 or 1).

- **Sets per Muscle Group**, **Avg Sets per Workout (where trained)**, and
  **Muscle Group Frequency** are three separate screens/buttons that all
  share one aggregation function, `computeMuscleGroupStats(startDate, endDate)`
  — one `WorkoutRepo.getRangeStatsData` call joined against `getAllExercises()`,
  returning total sets per group (bar chart) and, per group, a
  `Map(workoutId -> set count)` used to compute the other two: workouts
  that never touched a group don't dilute its average (a leg day never
  counts toward chest), and "not trained in this range" is shown instead of
  a misleading "0" wherever a group has no qualifying workouts.
- **Workout Stats** — training frequency (workouts/week) and the
  training/rest/total day count respect the range selector; **current/longest
  streak do not** — `WorkoutRepo.getWeeklyStreaks()` is deliberately
  all-time only (a week is "trained" if it has >=1 workout; a streak is
  consecutive trained weeks; the current calendar week not having a workout
  yet doesn't break the streak, since that week isn't over), labeled
  "All-time" in the UI so it's clear why it doesn't move when the range does.
- **Exercise Rankings** — Most/Least Trained toggle (a `.segmented-control`)
  over exercises ranked by set count in range; Least Trained deliberately
  includes exercises with zero sets (arguably the most extreme case of
  "least trained"), Most Trained excludes them.

(A "PRs over time" chart existed briefly here and was removed — the
per-exercise PR history/chart via "Exercise Stats" already covers this.)

**Shared chart module** (`window.WorkoutCharts` in `workout.js`):
`buildLineChartSvg(points, {formatValue, onSelect})` (extracted from
`ExerciseHistoryController.buildChart` so both callers share one
implementation) and `buildBarChartSvg(bars, {formatValue})` — a
*horizontal* bar chart, which reads far better than vertical columns once
there are more than a handful of categories (18 muscle groups) on a narrow
phone screen. Both are dumb: callers own their own caption/empty-state UI
and pass in a value formatter rather than the module knowing what a
"point" or "bar" means.

## Shared singleton overlays — an important gotcha

`#exercise-picker`, `#note-editor`, `#rir-picker`, `#gym-picker`,
`#pr-dialog`, and `#exercise-history-screen` are each a single DOM element
shared by multiple entry points (Active Workout, Workout Detail, and/or the
Stats tab). Each is backed by exactly one controller instance
(`sharedExercisePicker`, `sharedNoteEditor`, `sharedRirPicker`,
`sharedGymPicker`, `sharedPRDialog`, `sharedExerciseHistory`, all declared
once near the top of `workout.js`), and every caller holds a reference to
that same instance rather than constructing its own. If two instances ever
bound click handlers to the same shared DOM element, whichever was
constructed last would silently steal the bindings and break the other
caller. Any new full-screen popup shared between callers must follow this
same pattern — see `ExerciseHistoryController` for the template, and note
that `exercises.js` reaches it via `window.WorkoutExerciseHistory.open(...)`
since it's the only cross-file caller (the two `workout.js`-internal
controllers just call `sharedExerciseHistory` directly, like the other
shared pickers). `plans.js` is a second cross-file caller that needs
`sharedExercisePicker`/`sharedRirPicker`/`sharedRpePicker` (for the
template editor's "Add Exercise" and per-set RIR/RPE target buttons) — the
same three instances get exposed via `window.WorkoutSharedPickers`
(alongside their `RIR_COLORS`/`RPE_COLORS` maps, needed to color-code an
already-picked target the same way the live workout screen does), rather
than `plans.js` constructing its own instances and double-binding those
overlays' handlers.

Similarly, `#confirm-dialog` (the generic Yes/No confirm) is deliberately
the *last* element in `index.html`'s body, after every other overlay. There
is no explicit z-index management — later DOM siblings paint on top — and
`showConfirm()` can be triggered from inside an already-open dialog (e.g.
Mark as PR), so it must always be the last sibling to guarantee it's the
one visible.

## i18n (`i18n.js`)

`window.I18n.t(key, language, params)` — flat key map, each key has `en`/`pl`
strings, `{paramName}` tokens get interpolated from `params`. Language is
persisted in the `settings` store and applied via `data-i18n` /
`data-i18n-placeholder` attributes plus an `app:languagechange` event that
every controller listens for to re-render its currently-visible text.

## Service worker updates — safe activation + changelog (`updates.js`, `changelog.js`)

An update should never interrupt someone mid-workout, so a newly-installed
service worker no longer activates itself automatically — `sw.js`'s
`install` handler precaches the new app shell but deliberately does **not**
call `self.skipWaiting()` anymore. It sits in the `waiting` state until the
page (`updates.js`) explicitly posts it `{ type: 'SKIP_WAITING' }` — which
only happens when `WorkoutRepo.getDraft()` comes back empty
(`maybeActivateWaiting`). If a draft is active, the waiting worker just...
waits; the next time this check runs (next app load, or the next update
check) and finds no draft, it activates then. `sw.js`'s own `message`
listener is the other half: `self.skipWaiting()` only ever runs in response
to that message, never on its own.

**Precaching gotcha, found the hard way**: the `install` handler fetches
every `APP_SHELL` file with `{ cache: 'reload' }` explicitly, **not**
`cache.addAll(APP_SHELL)`. The difference matters a lot: `cache.addAll`
fetches each URL under normal HTTP caching rules, so it can silently pull
a *stale* copy straight from the browser's own HTTP cache instead of the
real current file — even during a genuinely new install. `sw.js` itself is
exempt from this (browsers always re-fetch the worker script bypassing
cache when checking for updates, per spec), which is exactly how this bug
hid in production: `CACHE_NAME` correctly read as the new version (so the
update popup, the version tracker, everything *looked* right) while one or
more of the other precached files — `exercises.js`, `changelog.js` — were
silently serving old content underneath. Symptom in practice: "the app
says it updated to v56, but the muscle-group picker still looks old and
'See Changes' says there's nothing new." `{ cache: 'reload' }` forces every
one of these fetches to hit the network for real, matching the guarantee
the browser already gives `sw.js` itself.

**Registration timing gotcha**: `updates.js` registers the service worker
at *module-load time* (checking `document.readyState` directly, falling
back to a `window 'load'` listener only if the page hasn't finished
loading yet) — deliberately **not** inside its exported `init()`, which
`app.js` only calls after several `await`s in its own bootstrap
(`db.open()`, `runMigrations()`, `I18n.getLanguage()`). Gating registration
behind those awaits was tried first and caused a real bug: on a fast page
load, the browser's `load` event can fire *before* `initApp()`'s chain of
awaits ever reaches the point of attaching a `window.addEventListener('load', ...)`
listener — so the listener would simply never fire and the service worker
would silently never register. Checking `readyState` synchronously at
parse time (this script is the last thing in `<body>`, so all its
dependencies already exist) avoids the race entirely.

**Once a new worker actually activates** (`sw.js`'s `activate` handler,
after `clients.claim()`), it posts `{ type: 'ACTIVATED', version: CACHE_NAME }`
to every open client. `updates.js`'s `handleActivated(newVersion)` compares
this against `settings.lastKnownAppVersion`:
- No stored version yet (first-ever run) → just seed it, no popup — nothing
  to announce yet.
- Same version → no-op (already know about this one; also what makes the
  popup naturally show at most once per transition, no extra bookkeeping
  needed).
- Different version → update `lastKnownAppVersion`, show the "Update
  Installed" popup (`#update-popup-dialog`: OK / "See Changes").

After the popup (and the "See Changes" screen, if opened) is dismissed,
the page does a full `location.reload()`. Activation only changes which
files the service worker hands out for *future* requests — the
already-running page was loaded under the old code and doesn't retroactively
become the new code without a reload. Safe unconditionally here since
activation itself only ever happens with no draft active.

**`lastKnownAppVersion` is install/device state, not user data** — it's
deliberately preserved across every destructive-replace action, even when
the incoming data doesn't have one of its own: `Database.restoreAll()`
(Import All Data, Load Sample Data), Dev Tools' "Wipe All Data", and Dev
Tools' generic per-store Import/Delete when specifically targeting the
`settings` store (the one raw/manual path where you could otherwise
directly overwrite or clear that single record). Every one of these only
*fills the gap* if the resulting record is missing the field — a backup
that legitimately carries its own `lastKnownAppVersion` (e.g. one taken
after this feature existed) is still respected as-is, never clobbered.
Losing this value doesn't corrupt anything, but it does look like a fresh
install with nothing to compare against, silently skipping the "what's
new" popup for whatever version transition happens next — which is
exactly what happened once in practice (recovering data via Load Sample
Data before this protection existed ate several versions' worth of
changelog). The Account tab's **"Release Notes"** button is the reliable
fallback regardless of this tracking's state — it just shows the entire
`changelog.js` array, unconditionally.

"See Changes" opens `#update-changes-screen`, listing
`Changelog.getEntriesBetween(previousVersion, newVersion)` grouped under a
per-version heading (falls back to a plain "no details available" message
if the hand-maintained changelog has a gap for that range). `changelog.js`
is a plain ordered array (`{ version, date, changes[] }`, oldest first) —
`version` must be the *exact* `CACHE_NAME` string, matched by array
position rather than parsed/compared numerically (see the reminder in
"Running it" above: bump both together on every deploy). Deliberately a
plain JS file, not an IndexedDB store — this is shipped app metadata, not
user data, so it's correctly invisible to Dev Tools / Export / Import /
Wipe All Data.

**Status indicator** (`#update-status-indicator`, a small fixed pill, not a
blocking modal): `checkForUpdate()` is the single function behind both the
automatic on-load check and the Account tab's "Check for Updates" button
(`registration.update()` plus whatever the `updatefound` listener — set up
once at registration time — reports). Shows "Checking for updates…" while
`update()` runs, "Downloading update…" while a newly-found worker's state
is `'installing'`, then quietly fades a moment after it settles — no
"you're up to date" message on the no-update path, since this is meant to
be a low-key status, not a decision point.

`registration.update()` is raced against a 10s timeout
(`UPDATE_CHECK_TIMEOUT_MS`) rather than awaited directly — some mobile
browsers (notably older iOS Safari) have a history of this call just
hanging forever instead of resolving or rejecting. Without the race, a
hang there means "Checking for updates…" stays stuck on screen
permanently and the manual button looks dead (it's still "awaiting" the
previous call) — confirmed via a real hang-simulation test, not just
theoretical.

**Popup queue** (`window.WorkoutDialogs.runExclusive`, defined in
`workout.js` next to `showConfirm`): up to three different things can each
want to show a blocking startup dialog — the draft-expiry check
(`checkExpiryOnLoad`), the backup reminder (`backup.js`), and this update
popup. The first two are already sequential via `app.js`'s own `await`
chain, but the update popup is fundamentally different: it's triggered by
an async `ACTIVATED` service-worker message that can arrive at literally
any time, completely independent of that startup sequence — without
coordination it could show on top of (or get buried invisibly behind) one
of the other two. `runExclusive(fn)` chains every popup-showing call onto
one shared promise tail, so whichever was queued first fully resolves
(user dismisses it) before the next one shows — never two open at once.
All three call sites wrap only the dialog-showing call itself, not
whatever happens after (e.g. `checkExpiryOnLoad` wraps just its
`showConfirm`, not the subsequent `openExisting()` screen — a queued
popup shouldn't have to wait for an entire workout session to finish).
