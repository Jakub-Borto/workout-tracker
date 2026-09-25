'use strict';

/*
 * Minimal i18n layer. Language preference is persisted in the settings
 * store (WorkoutDB) so it survives reloads. All static UI copy lives in
 * TRANSLATIONS keyed by translation key -> { en, pl }.
 */

(function () {

const DEFAULT_LANGUAGE = 'en';
const SUPPORTED_LANGUAGES = ['en', 'pl'];

const TRANSLATIONS = {
  'nav.home': { en: 'Home', pl: 'Start' },
  'nav.exercises': { en: 'Exercises', pl: 'Ćwiczenia' },
  'nav.bodyweight': { en: 'Bodyweight', pl: 'Waga ciała' },
  'nav.stats': { en: 'Stats', pl: 'Statystyki' },
  'nav.account': { en: 'Account', pl: 'Konto' },

  'home.title': { en: 'Home', pl: 'Start' },
  'home.startWorkout': { en: 'Start Empty Workout', pl: 'Rozpocznij trening' },

  'exercises.title': { en: 'Exercises', pl: 'Ćwiczenia' },
  'exercises.emptyTitle': { en: 'No exercises yet', pl: 'Brak ćwiczeń' },
  'exercises.emptySubtitle': {
    en: 'Add your first exercise to start building your library.',
    pl: 'Dodaj pierwsze ćwiczenie, aby zacząć budować swoją bazę.',
  },
  'exercises.addButton': { en: 'Add Exercise', pl: 'Dodaj ćwiczenie' },
  'exercises.searchPlaceholder': { en: 'Search exercises', pl: 'Szukaj ćwiczeń' },
  'exercises.filterButton': { en: 'Filter', pl: 'Filtruj' },
  'exercises.noResultsTitle': { en: 'No matching exercises', pl: 'Brak pasujących ćwiczeń' },
  'exercises.noResultsSubtitle': {
    en: 'Try a different search or clear the muscle group filter.',
    pl: 'Spróbuj innego wyszukiwania lub wyczyść filtr partii mięśniowej.',
  },
  'exercises.clearFilters': { en: 'Clear filters', pl: 'Wyczyść filtry' },

  'exercise.editor.titleNew': { en: 'New Exercise', pl: 'Nowe ćwiczenie' },
  'exercise.favoriteToggle': { en: 'Toggle favorite', pl: 'Przełącz ulubione' },
  'exercise.editor.titleEdit': { en: 'Edit Exercise', pl: 'Edytuj ćwiczenie' },
  'exercise.editor.nameLabel': { en: 'Name', pl: 'Nazwa' },
  'exercise.editor.namePlaceholder': { en: 'e.g. Bench Press', pl: 'np. Wyciskanie sztangi' },
  'exercise.editor.muscleGroupsLabel': { en: 'Muscle Groups', pl: 'Partie mięśniowe' },
  'exercise.editor.metricLabel': { en: 'Metric', pl: 'Metryka' },
  'exercise.editor.metricTypeLabel': { en: 'Type', pl: 'Typ' },
  'exercise.editor.metricUnitLabel': { en: 'Unit', pl: 'Jednostka' },
  'exercise.editor.effortTrackingLabel': { en: 'Effort Tracking', pl: 'Śledzenie wysiłku' },
  'exercise.editor.metricEffortWarning': {
    en: "Renaming this exercise, changing its muscle groups, or editing its notes is always safe — old workout logs update to match. Changing the metric or effort tracking (RIR/RPE) is different: past logged sets aren't converted, so they can end up displaying incorrectly under the new definition. If this exercise hasn't been logged yet, changing anything is safe.",
    pl: 'Zmiana nazwy, grup mięśniowych lub notatek tego ćwiczenia jest zawsze bezpieczna — stare wpisy treningowe dopasują się automatycznie. Zmiana metryki lub śledzenia wysiłku (RIR/RPE) jest inna: zapisane wcześniej serie nie zostaną przeliczone, więc mogą wyświetlać się niepoprawnie względem nowej definicji. Jeśli to ćwiczenie nie było jeszcze nigdy zalogowane, zmiana czegokolwiek jest bezpieczna.',
  },
  'exercise.editor.confirmMetricChangeTitle': { en: 'Change metric or effort tracking?', pl: 'Zmienić metrykę lub śledzenie wysiłku?' },
  'exercise.editor.confirmMetricChangeMessage': {
    en: "This exercise already has logged sets. They won't be converted, so they may now display incorrectly under the new metric or effort tracking. Save anyway?",
    pl: 'To ćwiczenie ma już zapisane serie. Nie zostaną one przeliczone, więc mogą teraz wyświetlać się niepoprawnie przy nowej metryce lub śledzeniu wysiłku. Zapisać mimo to?',
  },
  'exercise.editor.confirmMetricChangeSave': { en: 'Save Anyway', pl: 'Zapisz mimo to' },
  'exercise.editor.notesLabel': { en: 'Notes', pl: 'Notatki' },
  'exercise.editor.notesPlaceholder': { en: 'Optional notes', pl: 'Opcjonalne notatki' },
  'exercise.editor.cancel': { en: 'Cancel', pl: 'Anuluj' },
  'exercise.editor.save': { en: 'Save', pl: 'Zapisz' },
  'exercise.editor.delete': { en: 'Delete Exercise', pl: 'Usuń ćwiczenie' },
  'exercise.editor.confirmDeleteTitle': { en: 'Delete exercise?', pl: 'Usunąć ćwiczenie?' },
  'exercise.editor.confirmDeleteNoHistory': {
    en: '"{name}" will be permanently deleted. It hasn\'t been logged in any workout yet.',
    pl: '„{name}” zostanie trwale usunięte. Nie zostało jeszcze zapisane w żadnym treningu.',
  },
  'exercise.editor.confirmDeleteWithHistory': {
    en: '"{name}" has {sets} logged set(s) across {workouts} workout(s). Deleting it also permanently deletes those sets, its PRs and notes, and removes it from your workout templates. Past workouts left with nothing in them are deleted too. This cannot be undone.',
    pl: '„{name}” ma {sets} zapisanych serii w {workouts} treningach. Usunięcie go trwale usunie też te serie, jego rekordy i notatki oraz usunie je z szablonów treningów. Treningi, w których nic nie zostanie, również zostaną usunięte. Tej operacji nie można cofnąć.',
  },
  'exercise.editor.confirmDeleteInWorkout': {
    en: 'It will also be removed from your current workout.',
    pl: 'Zostanie też usunięte z bieżącego treningu.',
  },
  'exercise.editor.errorName': { en: 'Name is required.', pl: 'Nazwa jest wymagana.' },
  'exercise.editor.errorMetric': {
    en: 'The metric needs both a type and a unit.',
    pl: 'Metryka wymaga typu i jednostki.',
  },
  'exercise.editor.errorMuscleGroups': {
    en: 'Select at least one muscle group.',
    pl: 'Wybierz co najmniej jedną partię mięśniową.',
  },

  'effortTracking.none': { en: 'None', pl: 'Brak' },
  'effortTracking.rir': { en: 'RIR', pl: 'RIR' },
  'effortTracking.rpe': { en: 'RPE', pl: 'RPE' },

  'metricType.reps': { en: 'Reps', pl: 'Powtórzenia' },
  'metricType.reps_per_side': { en: 'Reps per side', pl: 'Powtórzenia na stronę' },
  'metricType.seconds': { en: 'Seconds', pl: 'Sekundy' },
  'metricType.min_sec': { en: 'min:sec', pl: 'min:sek' },
  'metricType.hr_min': { en: 'hr:min', pl: 'godz:min' },
  'metricType.meters': { en: 'Meters', pl: 'Metry' },

  'unit.none': { en: 'None', pl: 'Brak' },
  'unit.kg': { en: 'kg', pl: 'kg' },
  'unit.kg_per_side': { en: 'kg per side', pl: 'kg na stronę' },
  'unit.lbs': { en: 'lbs', pl: 'lbs' },
  'unit.lbs_per_side': { en: 'lbs per side', pl: 'lbs na stronę' },
  'unit.centimeters': { en: 'centimeters', pl: 'centymetry' },
  'unit.meters': { en: 'meters', pl: 'metry' },
  'unit.km': { en: 'km', pl: 'km' },
  'unit.miles': { en: 'miles', pl: 'mile' },
  'unit.watts': { en: 'watts', pl: 'waty' },
  'unit.resistance_level': { en: 'resistance level', pl: 'poziom oporu' },

  'muscleGroup.none': { en: 'None', pl: 'Brak' },
  'muscleGroup.neck': { en: 'Neck', pl: 'Szyja' },
  'muscleGroup.chest': { en: 'Chest', pl: 'Klatka piersiowa' },
  'muscleGroup.upper_chest': { en: 'Upper Chest', pl: 'Górna klatka piersiowa' },
  'muscleGroup.shoulders': { en: 'Shoulders', pl: 'Barki' },
  'muscleGroup.lower_back': { en: 'Lower Back', pl: 'Dolna część pleców' },
  'muscleGroup.lats': { en: 'Back (Lats)', pl: 'Plecy (Najszersze grzbietu)' },
  'muscleGroup.traps': { en: 'Back (Traps)', pl: 'Plecy (Czworoboczne)' },
  'muscleGroup.teres': { en: 'Back (Teres)', pl: 'Plecy (Obłe)' },
  'muscleGroup.bicep': { en: 'Bicep', pl: 'Biceps' },
  'muscleGroup.tricep': { en: 'Tricep', pl: 'Triceps' },
  'muscleGroup.forearm': { en: 'Forearm', pl: 'Przedramię' },
  'muscleGroup.abs_core': { en: 'Abs/Core', pl: 'Brzuch/Core' },
  'muscleGroup.quads': { en: 'Quads', pl: 'Czworogłowe' },
  'muscleGroup.hamstring': { en: 'Hamstring', pl: 'Dwugłowe uda' },
  'muscleGroup.glutes': { en: 'Glutes', pl: 'Pośladki' },
  'muscleGroup.abductor': { en: 'Abductor', pl: 'Odwodziciele' },
  'muscleGroup.adductor': { en: 'Adductor', pl: 'Przywodziciele' },
  'muscleGroup.calves': { en: 'Calves', pl: 'Łydki' },
  'muscleGroup.cardio': { en: 'Cardio', pl: 'Cardio' },
  'muscleGroup.rehab': { en: 'Rehab', pl: 'Rehabilitacja' },
  'muscleGroup.full_body': { en: 'Full Body', pl: 'Całe ciało' },

  'common.yes': { en: 'Yes', pl: 'Tak' },
  'common.no': { en: 'No', pl: 'Nie' },
  'common.cancel': { en: 'Cancel', pl: 'Anuluj' },
  'common.close': { en: 'Close', pl: 'Zamknij' },
  'common.ok': { en: 'OK', pl: 'OK' },
  'common.save': { en: 'Save', pl: 'Zapisz' },
  'common.delete': { en: 'Delete', pl: 'Usuń' },

  'gyms.title': { en: 'Gyms', pl: 'Siłownie' },
  'gyms.general': { en: 'General', pl: 'Ogólna' },
  'gyms.addPlaceholder': { en: 'Gym name', pl: 'Nazwa siłowni' },
  'gyms.addButton': { en: 'Add', pl: 'Dodaj' },
  'gyms.confirmDeleteTitle': { en: 'Delete this gym?', pl: 'Usunąć tę siłownię?' },
  'gyms.confirmDeleteMessage': {
    en: 'Sets already logged at "{name}" will fall back to General.',
    pl: 'Serie zapisane już w "{name}" wrócą do siłowni Ogólnej.',
  },

  'plans.sectionTitle': { en: 'Workout Plans', pl: 'Plany treningowe' },
  'plans.createButton': { en: 'Create Workout Plan', pl: 'Utwórz plan treningowy' },
  'plans.createPromptTitle': { en: 'New Plan', pl: 'Nowy plan' },
  'plans.createPromptConfirm': { en: 'Create', pl: 'Utwórz' },
  'plans.builderTitle': { en: 'Plan', pl: 'Plan' },
  'plans.nameLabel': { en: 'Name', pl: 'Nazwa' },
  'plans.noTemplatesYet': {
    en: 'No workout templates yet. Tap below to add one.',
    pl: 'Brak jeszcze szablonów treningów. Dotknij poniżej, aby dodać.',
  },
  'plans.deletePlan': { en: 'Delete Plan', pl: 'Usuń plan' },
  'plans.confirmDeletePlanTitle': { en: 'Delete {name}?', pl: 'Usunąć {name}?' },
  'plans.confirmDeletePlanMessage': {
    en: 'This permanently deletes this plan and all of its workout templates. This cannot be undone.',
    pl: 'To trwale usunie ten plan i wszystkie jego szablony treningów. Tej operacji nie można cofnąć.',
  },
  'plans.addTemplateButton': { en: 'Add Workout Template', pl: 'Dodaj szablon treningu' },
  'plans.startTemplate': { en: 'Start this workout', pl: 'Rozpocznij ten trening' },
  'plans.editTemplate': { en: 'Edit template', pl: 'Edytuj szablon' },
  'plans.moveUp': { en: 'Move up', pl: 'Przesuń w górę' },
  'plans.moveDown': { en: 'Move down', pl: 'Przesuń w dół' },
  'plans.deleteTemplate': { en: 'Delete template', pl: 'Usuń szablon' },
  'plans.confirmDeleteTemplateTitle': { en: 'Delete Workout Template?', pl: 'Usunąć szablon treningu?' },
  'plans.confirmDeleteTemplateMessage': {
    en: 'This permanently deletes this workout template. This cannot be undone.',
    pl: 'To trwale usunie ten szablon treningu. Tej operacji nie można cofnąć.',
  },
  'plans.conflictTitle': { en: 'Workout in Progress', pl: 'Trening w toku' },
  'plans.conflictMessage': {
    en: "You can't start a new workout while another one is active.",
    pl: 'Nie możesz rozpocząć nowego treningu, gdy inny jest aktywny.',
  },
  'plans.conflictGoHome': { en: 'Go to Home', pl: 'Przejdź do strony głównej' },

  'plans.templateEditor.titleNew': { en: 'New Workout Template', pl: 'Nowy szablon treningu' },
  'plans.templateEditor.titleEdit': { en: 'Edit Workout Template', pl: 'Edytuj szablon treningu' },
  'plans.templateEditor.nameLabel': { en: 'Name', pl: 'Nazwa' },
  'plans.templateEditor.addExercise': { en: '+ Add Exercise', pl: '+ Dodaj ćwiczenie' },
  'plans.templateEditor.pickExerciseTitle': { en: 'Add Exercise', pl: 'Dodaj ćwiczenie' },
  'plans.templateEditor.removeExercise': { en: 'Remove exercise', pl: 'Usuń ćwiczenie' },
  'plans.templateEditor.warmupSetsLabel': { en: 'Warm-up Sets', pl: 'Serie rozgrzewkowe' },
  'plans.templateEditor.workingSetsLabel': { en: 'Working Sets', pl: 'Serie robocze' },
  'plans.templateEditor.rirTargetsLabel': {
    en: 'RIR Targets (per working set)',
    pl: 'Cele RIR (na serię roboczą)',
  },
  'plans.templateEditor.rpeTargetsLabel': {
    en: 'RPE Targets (per working set)',
    pl: 'Cele RPE (na serię roboczą)',
  },
  'plans.templateEditor.errorNameRequired': { en: 'Name is required.', pl: 'Nazwa jest wymagana.' },
  'plans.errorNameRequired': { en: 'Give the plan a name.', pl: 'Nadaj planowi nazwę.' },
  'plans.templateEditor.errorNoExercises': {
    en: 'Add at least one exercise.',
    pl: 'Dodaj co najmniej jedno ćwiczenie.',
  },
  'plans.templateEditor.delete': { en: 'Delete Template', pl: 'Usuń szablon' },
  'plans.templateEditor.deletedExercise': { en: 'Deleted Exercise ({id})', pl: 'Usunięte ćwiczenie ({id})' },

  'calendar.choiceTitle': { en: 'Workout Options', pl: 'Opcje treningu' },
  'calendar.viewWorkout': { en: 'View Workout', pl: 'Zobacz trening' },
  'calendar.startSameWorkout': { en: 'Start the Same Workout', pl: 'Rozpocznij ten sam trening' },
  'calendar.addToPlan': { en: 'Add to Plan', pl: 'Dodaj do planu' },
  'calendar.planPickerTitle': { en: 'Add to Plan', pl: 'Dodaj do planu' },
  'calendar.noPlansYet': {
    en: "You don't have any workout plans yet. Create one from the Home tab first.",
    pl: 'Nie masz jeszcze żadnych planów treningowych. Najpierw utwórz jeden na karcie Home.',
  },
  'calendar.addToPlanDoneTitle': { en: 'Added to Plan', pl: 'Dodano do planu' },
  'calendar.addToPlanDoneMessage': {
    en: 'This workout was added to "{plan}" as a new workout template.',
    pl: 'Ten trening został dodany do "{plan}" jako nowy szablon treningu.',
  },

  'updates.checking': { en: 'Checking for updates…', pl: 'Sprawdzanie aktualizacji…' },
  'updates.downloading': { en: 'Downloading update…', pl: 'Pobieranie aktualizacji…' },
  'updates.popupTitle': { en: 'Update Installed', pl: 'Zainstalowano aktualizację' },
  'updates.popupMessage': {
    en: 'An update has been installed. Your app is now on the latest version.',
    pl: 'Zainstalowano aktualizację. Twoja aplikacja jest teraz w najnowszej wersji.',
  },
  'updates.seeChanges': { en: 'See Changes', pl: 'Zobacz zmiany' },
  'updates.changesTitle': { en: "What's New", pl: 'Co nowego' },
  'updates.noChangesFallback': {
    en: 'No change details are available for this update.',
    pl: 'Brak szczegółów zmian dla tej aktualizacji.',
  },
  'updates.checkButton': { en: 'Check for Updates', pl: 'Sprawdź aktualizacje' },
  'updates.releaseNotesButton': { en: 'Release Notes', pl: 'Informacje o wersji' },

  'workout.defaultName': { en: 'Workout', pl: 'Trening' },
  'workout.resumeBar': { en: 'Come back to workout', pl: 'Wróć do treningu' },
  'workout.pickExerciseTitleAdd': { en: 'Add Exercise', pl: 'Dodaj ćwiczenie' },
  'workout.pickExerciseTitleSwap': { en: 'Swap Exercise', pl: 'Zamień ćwiczenie' },
  'workout.finishWorkout': { en: 'Finish Workout', pl: 'Zakończ trening' },
  'workout.timerStart': { en: 'Start', pl: 'Start' },
  'workout.timerPause': { en: 'Pause', pl: 'Pauza' },
  'workout.timerReset': { en: 'Reset', pl: 'Reset' },
  'workout.noteTitle': { en: 'Exercise Note', pl: 'Notatka do ćwiczenia' },
  'workout.notePlaceholder': {
    en: 'Note for next time you do this exercise…',
    pl: 'Notatka na następny raz dla tego ćwiczenia…',
  },
  'workout.dismissNote': { en: 'Dismiss', pl: 'Ukryj' },
  'workout.noteGlobalLabel': { en: 'Exercise Note', pl: 'Notatka ogólna' },
  'workout.notePreviousLabel': { en: 'Last Time', pl: 'Ostatnim razem' },
  'workout.noteNewLabel': { en: 'New Note', pl: 'Nowa notatka' },
  'workout.warmupLabel': { en: 'Warmup', pl: 'Rozgrzewka' },
  'workout.setOfY': { en: 'Set {x} of {y}', pl: 'Seria {x} z {y}' },
  'workout.addSet': { en: 'Add Set', pl: 'Dodaj serię' },
  'workout.addWarmup': { en: 'Add Warmup', pl: 'Dodaj rozgrzewkę' },
  'workout.swap': { en: 'Swap', pl: 'Zamień' },
  'workout.editExercise': { en: 'Edit', pl: 'Edytuj' },
  'workout.remove': { en: 'Remove', pl: 'Usuń' },
  'workout.deletedExercise': { en: 'Deleted exercise', pl: 'Usunięte ćwiczenie' },
  'workout.deletedExerciseMessage': {
    en: 'This exercise no longer exists, so its sets can\'t be shown. Remove it from this workout.',
    pl: 'To ćwiczenie już nie istnieje, więc jego serii nie da się wyświetlić. Usuń je z tego treningu.',
  },
  'workout.nothingToSaveTitle': { en: 'Nothing to save', pl: 'Nie ma czego zapisać' },
  'workout.nothingToSaveMessage': {
    en: 'You haven\'t completed any sets, so there\'s nothing to save. Discard this workout?',
    pl: 'Nie ukończyłeś żadnej serii, więc nie ma czego zapisać. Odrzucić ten trening?',
  },
  'workout.keepEditing': { en: 'Keep editing', pl: 'Edytuj dalej' },
  'workout.discardChangesTitle': { en: 'Discard changes?', pl: 'Odrzucić zmiany?' },
  'workout.discardChangesMessage': {
    en: 'You have unsaved changes to this workout. Close without saving?',
    pl: 'Masz niezapisane zmiany w tym treningu. Zamknąć bez zapisywania?',
  },
  'workout.deleteSet': { en: 'Delete set', pl: 'Usuń serię' },
  'workout.confirmDeleteSetTitle': { en: 'Delete this set?', pl: 'Usunąć tę serię?' },
  'workout.confirmDeleteSetMessage': {
    en: 'Its logged values will be lost.',
    pl: 'Zapisane wartości zostaną utracone.',
  },
  'workout.confirmSwapTitle': { en: 'Swap exercise?', pl: 'Zamienić ćwiczenie?' },
  'workout.confirmSwapMessage': {
    en: 'This removes the sets and note already logged for it in this workout.',
    pl: 'Usunie to serie i notatkę już zapisane dla niego w tym treningu.',
  },
  'workout.detailNamePlaceholder': { en: 'Workout name', pl: 'Nazwa treningu' },
  'workout.deleteWorkout': { en: 'Delete Workout', pl: 'Usuń trening' },
  'workout.confirmDeleteWorkoutTitle': { en: 'Delete this workout?', pl: 'Usunąć ten trening?' },
  'workout.confirmDeleteWorkoutMessage': {
    en: 'This permanently deletes the workout and all its logged sets and notes. This cannot be undone.',
    pl: 'To trwale usunie trening oraz wszystkie zapisane serie i notatki. Tej operacji nie można cofnąć.',
  },
  'workout.rirPickerTitle': { en: 'RIR', pl: 'RIR' },
  'workout.rpePickerTitle': { en: 'RPE', pl: 'RPE' },
  'workout.rirClear': { en: 'Clear', pl: 'Wyczyść' },
  'workout.confirmRemoveTitle': { en: 'Remove exercise?', pl: 'Usunąć ćwiczenie?' },
  'workout.confirmRemoveMessage': {
    en: 'This removes it and any sets logged for it in this workout. It will not affect the exercise itself.',
    pl: 'Usunie to ćwiczenie i wszystkie zapisane dla niego serie w tym treningu. Nie wpłynie to na samo ćwiczenie.',
  },
  'workout.note': { en: 'Note', pl: 'Notatka' },
  'workout.gym': { en: 'Gym', pl: 'Siłownia' },
  'workout.gymPickerTitle': { en: 'Select gym', pl: 'Wybierz siłownię' },
  'workout.prButton': { en: 'PR', pl: 'Rekord' },
  'workout.historyButton': { en: 'History', pl: 'Historia' },
  'workout.gymFilterAll': { en: 'All', pl: 'Wszystkie' },
  'workout.sideLeft': { en: 'L', pl: 'L' },
  'workout.sideRight': { en: 'R', pl: 'P' },
  'workout.historyEmpty': { en: 'No history yet for this exercise.', pl: 'Brak historii dla tego ćwiczenia.' },
  'workout.historyNoResultsForFilter': {
    en: 'No history for this gym yet.',
    pl: 'Brak historii dla tej siłowni.',
  },
  'workout.historyViewHistory': { en: 'History', pl: 'Historia' },
  'workout.historyViewPr': { en: 'PR', pl: 'Rekord' },
  'workout.historyViewChart': { en: 'Chart', pl: 'Wykres' },
  'workout.prHistoryEmpty': {
    en: 'No PRs marked yet for this exercise.',
    pl: 'Brak oznaczonych rekordów dla tego ćwiczenia.',
  },
  'workout.prHistoryNoResultsForFilter': {
    en: 'No PRs marked at this gym yet.',
    pl: 'Brak rekordów oznaczonych w tej siłowni.',
  },
  'workout.prTitle': { en: 'Personal Record', pl: 'Rekord życiowy' },
  'workout.prNone': { en: 'No PR saved yet for this gym.', pl: 'Brak zapisanego rekordu dla tej siłowni.' },
  'workout.prMarkButton': { en: 'Mark as PR', pl: 'Oznacz jako rekord' },
  'workout.confirmMarkPRTitle': { en: 'Save this as your PR?', pl: 'Zapisać to jako rekord?' },
  'workout.confirmMarkPRMessage': {
    en: 'This replaces the previously saved PR for this exercise and gym.',
    pl: 'Zastąpi to wcześniej zapisany rekord dla tego ćwiczenia i siłowni.',
  },
  'workout.moveLeft': { en: 'Move left', pl: 'Przesuń w lewo' },
  'workout.moveRight': { en: 'Move right', pl: 'Przesuń w prawo' },
  'workout.tableSet': { en: 'Set', pl: 'Seria' },
  'workout.tablePrevious': { en: 'Previous', pl: 'Poprzednio' },
  'workout.tableDone': { en: 'Done', pl: 'Gotowe' },
  'workout.noExercisesYet': {
    en: 'Tap + to add your first exercise.',
    pl: 'Stuknij +, aby dodać pierwsze ćwiczenie.',
  },
  'workout.confirmFinishTitle': { en: 'Finish workout?', pl: 'Zakończyć trening?' },
  'workout.confirmFinishMessage': {
    en: 'Are you sure you want to finish this workout?',
    pl: 'Czy na pewno chcesz zakończyć ten trening?',
  },
  'workout.discardButton': { en: 'Discard', pl: 'Odrzuć' },
  'workout.confirmDiscardTitle': { en: 'Discard workout?', pl: 'Odrzucić trening?' },
  'workout.confirmDiscardMessage': {
    en: 'This will delete everything logged in this workout. This cannot be undone.',
    pl: 'To usunie wszystko, co zapisano w tym treningu. Tej operacji nie można cofnąć.',
  },
  'workout.confirmIncompleteTitle': { en: 'Incomplete sets', pl: 'Niedokończone serie' },
  'workout.confirmIncompleteMessage': {
    en: "Some sets aren't marked done. They'll be deleted. Continue?",
    pl: 'Niektóre serie nie są oznaczone jako gotowe. Zostaną usunięte. Kontynuować?',
  },
  'workout.expiredTitle': { en: "Unfinished workout", pl: 'Niedokończony trening' },
  'workout.expiredMessage': {
    en: "Hey, you didn't finish your workout. Do you want to pick up where you left off?",
    pl: 'Nie dokończyłeś treningu. Czy chcesz do niego wrócić?',
  },

  'bodyweight.title': { en: 'Body :) weight', pl: 'Waga :) ciała' },
  'bodyweight.emptyTitle': { en: 'Nothing logged yet', pl: 'Brak wpisów' },
  'bodyweight.emptySubtitle': {
    en: 'Your bodyweight history will show up here.',
    pl: 'Tutaj pojawi się historia Twojej wagi ciała.',
  },

  'stats.title': { en: 'Stats', pl: 'Statystyki' },
  'stats.exerciseStatsButton': { en: 'Exercise Stats', pl: 'Statystyki ćwiczenia' },

  'stats.dateRangeLabel': { en: 'Date Range', pl: 'Zakres dat' },
  'stats.rangeThisWeek': { en: 'This Week', pl: 'Ten tydzień' },
  'stats.rangeThisMonth': { en: 'This Month', pl: 'Ten miesiąc' },
  'stats.rangeThisYear': { en: 'This Year', pl: 'Ten rok' },
  'stats.rangeAllTime': { en: 'All Time', pl: 'Cały czas' },
  'stats.rangeLastXDays': { en: 'Last {days} Days', pl: 'Ostatnie {days} dni' },
  'stats.lastXDaysLabel': { en: 'Last X Days', pl: 'Ostatnie X dni' },
  'stats.customDaysPlaceholder': { en: 'Custom days', pl: 'Własna liczba dni' },
  'stats.applyButton': { en: 'Apply', pl: 'Zastosuj' },
  'stats.rangeCustom': { en: 'Custom Range', pl: 'Własny zakres' },
  'stats.customRangeInclusiveNote': {
    en: 'Both dates are inclusive — the start and end day themselves are both counted.',
    pl: 'Obie daty są włącznie — dzień początkowy i końcowy również się liczą.',
  },
  'stats.startDateLabel': { en: 'Start Date', pl: 'Data początkowa' },
  'stats.endDateLabel': { en: 'End Date', pl: 'Data końcowa' },

  'stats.muscleGroupSectionTitle': { en: 'Muscle Group Stats', pl: 'Statystyki grup mięśniowych' },
  'stats.setsPerMuscleGroupTitle': { en: 'Sets per Muscle Group', pl: 'Serie na grupę mięśniową' },
  'stats.noSetsInRange': { en: 'No sets logged in this range.', pl: 'Brak serii zapisanych w tym zakresie.' },
  'stats.avgSetsPerWorkoutTitle': {
    en: 'Avg Sets per Workout (where trained)',
    pl: 'Śr. liczba serii na trening (gdy trenowano)',
  },
  'stats.notTrainedInRange': { en: 'Not trained in this range', pl: 'Nie trenowano w tym zakresie' },
  'stats.avgSetsValue': { en: '{avg} sets/workout', pl: '{avg} serii/trening' },
  'stats.muscleFrequencyTitle': { en: 'Muscle Group Frequency', pl: 'Częstotliwość grup mięśniowych' },
  'stats.timesPerWeekValue': { en: '{freq}x/week', pl: '{freq}x/tydz.' },

  'stats.workoutSectionTitle': { en: 'Workout Stats', pl: 'Statystyki treningów' },
  'stats.trainingFrequencyTitle': { en: 'Training Frequency', pl: 'Częstotliwość treningów' },
  'stats.allTimeTag': { en: 'All-time', pl: 'Od zawsze' },
  'stats.streakTitle': { en: 'Streaks (consecutive trained weeks)', pl: 'Serie (kolejne trenowane tygodnie)' },
  'stats.currentStreakLabel': { en: 'Current', pl: 'Aktualna' },
  'stats.longestStreakLabel': { en: 'Longest', pl: 'Najdłuższa' },
  'stats.trainingDayRatioTitle': { en: 'Training / Rest Days', pl: 'Dni treningowe / odpoczynku' },
  'stats.trainingDayRatioValue': {
    en: '{trained} training / {rest} rest / {total} total ({pct}%)',
    pl: '{trained} treningowych / {rest} odpoczynku / {total} łącznie ({pct}%)',
  },

  'stats.rankingsSectionTitle': { en: 'Exercise Rankings', pl: 'Rankingi ćwiczeń' },
  'stats.mostTrained': { en: 'Most Trained', pl: 'Najczęściej trenowane' },
  'stats.leastTrained': { en: 'Least Trained', pl: 'Najrzadziej trenowane' },
  'stats.setsCountValue': { en: '{count} sets', pl: '{count} serii' },

  'account.title': { en: 'Account', pl: 'Konto' },
  'account.languageSectionTitle': { en: 'Language', pl: 'Język' },
  'account.languageEnglish': { en: 'English', pl: 'Angielski' },
  'account.languagePolish': { en: 'Polish', pl: 'Polski' },
  'account.devToolsButton': { en: 'Dev Tools', pl: 'Narzędzia deweloperskie' },
  'account.addBaseExercisesButton': { en: 'Add Base Exercises', pl: 'Dodaj bazowe ćwiczenia' },
  'account.baseExercisesDialogTitle': { en: 'Add Base Exercises', pl: 'Dodaj bazowe ćwiczenia' },
  'account.baseExercisesLanguageLabel': { en: 'Language', pl: 'Język' },
  'account.baseExercisesOverwriteWarning': {
    en: 'This completely replaces your exercise library. Every exercise you have added or edited will be permanently deleted.',
    pl: 'To całkowicie zastąpi Twoją bazę ćwiczeń. Każde dodane lub edytowane przez Ciebie ćwiczenie zostanie trwale usunięte.',
  },
  'account.baseExercisesEffortWarning': {
    en: "This effort-tracking setting will be force-applied to every base exercise, even ones it doesn't make sense for (e.g. Running). You can adjust individual exercises afterward.",
    pl: 'To ustawienie śledzenia wysiłku zostanie wymuszone na każdym bazowym ćwiczeniu, nawet tam, gdzie nie ma to sensu (np. Bieganie). Możesz później dostosować poszczególne ćwiczenia.',
  },
  'account.baseExercisesConfirmButton': { en: 'Replace Exercises', pl: 'Zastąp ćwiczenia' },
  'account.baseExercisesErrorTitle': { en: 'Load Failed', pl: 'Wczytywanie nie powiodło się' },
  'account.baseExercisesFetchError': {
    en: 'Could not load the base exercises file. Try again.',
    pl: 'Nie udało się wczytać pliku bazowych ćwiczeń. Spróbuj ponownie.',
  },
  'account.exportBackupButton': { en: 'Export All Data', pl: 'Eksportuj wszystkie dane' },
  'account.importBackupButton': { en: 'Import All Data', pl: 'Importuj wszystkie dane' },
  'account.confirmBackupImportTitle': { en: 'Import Backup?', pl: 'Zaimportować kopię zapasową?' },
  'account.confirmBackupImportMessage': {
    en: 'This will replace ALL current data with this backup. Anything added or changed since the backup was made will be permanently deleted. This cannot be undone.',
    pl: 'Spowoduje to zastąpienie WSZYSTKICH bieżących danych tą kopią zapasową. Wszystko, co zostało dodane lub zmienione od momentu utworzenia kopii, zostanie trwale usunięte. Tej operacji nie można cofnąć.',
  },
  'account.backupImportDoneTitle': { en: 'Import Complete', pl: 'Import zakończony' },
  'account.backupImportDoneMessage': {
    en: 'Your backup has been loaded. The app will now reload.',
    pl: 'Twoja kopia zapasowa została wczytana. Aplikacja zostanie teraz ponownie załadowana.',
  },
  'account.backupImportErrorTitle': { en: 'Import Failed', pl: 'Import nie powiódł się' },
  'account.backupImportParseError': {
    en: 'That file is not valid JSON.',
    pl: 'Ten plik nie zawiera poprawnego JSON.',
  },
  'account.backupImportInvalidFile': {
    en: 'That file is not a complete Workout Tracker backup (missing: {stores}). Nothing was changed.',
    pl: 'Ten plik nie jest kompletną kopią zapasową Workout Tracker (brakuje: {stores}). Nic nie zostało zmienione.',
  },

  'account.backupReminderTitle': { en: 'Time for a backup', pl: 'Czas na kopię zapasową' },
  'account.backupReminderMessage': {
    en: "It's been a couple weeks since your last export. Tap Export Now to save a fresh copy — and it's a good idea to keep at least 2 backups on your phone, feel free to delete older ones.",
    pl: 'Minęło kilka tygodni od ostatniego eksportu. Dotknij Eksportuj teraz, aby zapisać świeżą kopię — warto trzymać na telefonie co najmniej 2 kopie zapasowe, starsze możesz spokojnie usuwać.',
  },
  'account.backupReminderExportNow': { en: 'Export Now', pl: 'Eksportuj teraz' },
  'account.backupReminderLater': { en: 'Remind Me Later', pl: 'Przypomnij później' },

  'devtools.title': { en: 'Dev Tools', pl: 'Narzędzia deweloperskie' },
  'devtools.refresh': { en: 'Refresh', pl: 'Odśwież' },
  'devtools.wipeAll': { en: 'Wipe All Data', pl: 'Wyczyść wszystkie dane' },
  'devtools.loadSampleData': { en: 'Load Sample Data', pl: 'Wczytaj przykładowe dane' },
  'devtools.confirmLoadSampleDataTitle': { en: 'Load sample data?', pl: 'Wczytać przykładowe dane?' },
  'devtools.confirmLoadSampleDataMessage': {
    en: 'This will replace ALL current data with the bundled example dataset. Anything you’ve added will be permanently deleted. This cannot be undone.',
    pl: 'Spowoduje to zastąpienie WSZYSTKICH bieżących danych dołączonym przykładowym zbiorem danych. Wszystko, co dodałeś, zostanie trwale usunięte. Tej operacji nie można cofnąć.',
  },
  'devtools.loadSampleDataErrorTitle': { en: 'Load Failed', pl: 'Wczytywanie nie powiodło się' },
  'devtools.loadSampleDataFetchError': {
    en: 'Could not load the bundled sample data file.',
    pl: 'Nie udało się wczytać dołączonego pliku z przykładowymi danymi.',
  },
  'devtools.loadSampleDataInvalidFile': {
    en: 'The bundled sample data file is incomplete (missing: {stores}). Nothing was changed.',
    pl: 'Dołączony plik z przykładowymi danymi jest niekompletny (brakuje: {stores}). Nic nie zostało zmienione.',
  },
  'devtools.deleteStore': { en: 'Delete this data', pl: 'Usuń te dane' },
  'devtools.deleteButton': { en: 'Delete', pl: 'Usuń' },
  'devtools.typeToConfirm': { en: 'Type this code to confirm:', pl: 'Wpisz ten kod, aby potwierdzić:' },
  'devtools.codeMismatch': { en: "That doesn't match. Try again.", pl: 'To nie pasuje. Spróbuj ponownie.' },
  'devtools.confirmWipeAllTitle': { en: 'Wipe all data?', pl: 'Wyczyścić wszystkie dane?' },
  'devtools.confirmWipeAllMessage': {
    en: 'This permanently deletes everything in every store: exercises, workouts, sets, notes, bodyweight entries, and settings. This cannot be undone.',
    pl: 'To trwale usunie wszystko z każdej bazy: ćwiczenia, treningi, serie, notatki, wpisy wagi ciała i ustawienia. Tej operacji nie można cofnąć.',
  },
  'devtools.confirmDeleteStoreTitle': { en: 'Delete {name}?', pl: 'Usunąć {name}?' },
  'devtools.confirmDeleteStoreMessage': {
    en: 'This permanently deletes every record in "{name}". This cannot be undone.',
    pl: 'To trwale usunie każdy rekord w „{name}”. Tej operacji nie można cofnąć.',
  },
  'devtools.empty': { en: '(empty)', pl: '(pusto)' },
  'devtools.draftNote': {
    en: 'This is the temporary in-progress workout — it only exists while a workout is being logged, and is deleted once finished or discarded.',
    pl: 'To tymczasowy, trwający trening — istnieje tylko podczas logowania treningu i jest usuwany po zakończeniu lub odrzuceniu.',
  },
  'devtools.exportStore': { en: 'Export this data', pl: 'Eksportuj te dane' },
  'devtools.importStore': { en: 'Import into this data', pl: 'Importuj do tych danych' },
  'devtools.importButton': { en: 'Import', pl: 'Importuj' },
  'devtools.confirmImportTitle': { en: 'Replace {name}?', pl: 'Zastąpić „{name}”?' },
  'devtools.confirmImportMessage': {
    en: 'This replaces ALL existing data in "{name}" with the {count} record(s) from the file. Anything currently in this store that isn\'t in the file will be permanently deleted. This cannot be undone.',
    pl: 'To zastąpi WSZYSTKIE dane w „{name}” {count} rekordami z pliku. Wszystko, co obecnie znajduje się w tym magazynie, a czego nie ma w pliku, zostanie trwale usunięte. Tej operacji nie można cofnąć.',
  },
  'devtools.importErrorTitle': { en: 'Import failed', pl: 'Import nie powiódł się' },
  'devtools.importParseError': {
    en: "That file isn't valid JSON.",
    pl: 'Ten plik nie jest prawidłowym JSON-em.',
  },
  'devtools.importInvalidFile': {
    en: 'Expected a JSON array of records, or an export file with a "records" array.',
    pl: 'Oczekiwano tablicy JSON z rekordami lub pliku eksportu z tablicą „records”.',
  },
  'devtools.store.exercises': { en: 'Exercises', pl: 'Ćwiczenia' },
  'devtools.store.workouts': { en: 'Workouts (finished)', pl: 'Treningi (zakończone)' },
  'devtools.store.sets': { en: 'Workout Sets', pl: 'Serie treningowe' },
  'devtools.store.exerciseNotes': { en: 'Exercise Notes', pl: 'Notatki do ćwiczeń' },
  'devtools.store.draftWorkout': { en: 'Draft Workout (temp)', pl: 'Trening roboczy (tymczasowy)' },
  'devtools.store.bodyweights': { en: 'Bodyweight Entries', pl: 'Wpisy wagi ciała' },
  'devtools.store.settings': { en: 'Settings', pl: 'Ustawienia' },
  'devtools.store.gyms': { en: 'Gyms', pl: 'Siłownie' },
  'devtools.store.personalRecords': { en: 'Personal Records', pl: 'Rekordy życiowe' },

  'workout.finishDialogTitle': { en: 'Finish Workout', pl: 'Zakończ trening' },
  'workout.finishDialogNameLabel': { en: 'Name', pl: 'Nazwa' },
  'workout.finishDialogDateLabel': { en: 'Date', pl: 'Data' },
  'workout.finishButton': { en: 'Finish', pl: 'Zakończ' },

  'weekday.mon': { en: 'Mon', pl: 'Pon' },
  'weekday.tue': { en: 'Tue', pl: 'Wt' },
  'weekday.wed': { en: 'Wed', pl: 'Śr' },
  'weekday.thu': { en: 'Thu', pl: 'Czw' },
  'weekday.fri': { en: 'Fri', pl: 'Pt' },
  'weekday.sat': { en: 'Sat', pl: 'Sob' },
  'weekday.sun': { en: 'Sun', pl: 'Nd' },
};

const LOCALE_BY_LANGUAGE = { en: 'en-US', pl: 'pl-PL' };

function t(key, language, params) {
  const entry = TRANSLATIONS[key];
  let text = entry ? entry[language] ?? entry[DEFAULT_LANGUAGE] ?? key : key;
  if (params) {
    text = text.replace(/\{(\w+)\}/g, (match, name) => (params[name] != null ? params[name] : match));
  }
  return text;
}

function localeFor(language) {
  return LOCALE_BY_LANGUAGE[language] ?? LOCALE_BY_LANGUAGE[DEFAULT_LANGUAGE];
}

async function getLanguage() {
  try {
    const { db, STORES } = window.WorkoutDB;
    const settings = await db.get(STORES.settings, 'app');
    const lang = settings?.language;
    return SUPPORTED_LANGUAGES.includes(lang) ? lang : DEFAULT_LANGUAGE;
  } catch (err) {
    console.error('Failed to read language setting', err);
    return DEFAULT_LANGUAGE;
  }
}

async function setLanguage(language) {
  if (!SUPPORTED_LANGUAGES.includes(language)) return;
  const { db, STORES } = window.WorkoutDB;
  const settings = (await db.get(STORES.settings, 'app')) ?? {
    key: 'app',
    schemaVersion: window.WorkoutDB.CURRENT_SCHEMA_VERSION,
  };
  settings.language = language;
  await db.put(STORES.settings, settings);
}

window.I18n = {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  t,
  localeFor,
  getLanguage,
  setLanguage,
};

})();
