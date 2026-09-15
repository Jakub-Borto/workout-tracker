'use strict';

/*
 * Hand-maintained release notes — one entry per shipped version, oldest
 * first. `version` must exactly match the CACHE_NAME value used in sw.js
 * for that release; bump both together on every deploy. Not auto-generated
 * from commits/diffs on purpose, and deliberately not stored in
 * IndexedDB — this is app code, not user data, so it's correctly excluded
 * from Import/Export/Wipe-All-Data.
 */

(function () {

const CHANGELOG = [
  {
    version: 'workout-tracker-v43',
    date: '2026-09-12',
    changes: ['Added one-tap full-database Export/Import in the Account tab'],
  },
  {
    version: 'workout-tracker-v44',
    date: '2026-09-12',
    changes: ['Import All Data now fully restores a backup instead of merging it in'],
  },
  {
    version: 'workout-tracker-v45',
    date: '2026-09-12',
    changes: ["Reopening an expired draft workout now lets you pick up where you left off, instead of auto-finishing it"],
  },
  {
    version: 'workout-tracker-v46',
    date: '2026-09-12',
    changes: ['Added a reminder to back up your data if it has been a while since your last export'],
  },
  {
    version: 'workout-tracker-v47',
    date: '2026-09-12',
    changes: ['Added a "Load Sample Data" button in Dev Tools for quick testing'],
  },
  {
    version: 'workout-tracker-v48',
    date: '2026-09-12',
    changes: [
      'Added Workout Plans: save reusable workout templates and start a workout from one',
      'New sets now auto-fill from your last workout, with +1 reps progression',
    ],
  },
  {
    version: 'workout-tracker-v49',
    date: '2026-09-12',
    changes: [
      'Tapping a workout on the calendar now offers View, Start the Same Workout, or Add to Plan',
    ],
  },
  {
    version: 'workout-tracker-v50',
    date: '2026-09-12',
    changes: [
      'Updates now install automatically in the background and notify you when ready',
      "Added a \"What's New\" screen and a manual Check for Updates button in the Account tab",
    ],
  },
  {
    version: 'workout-tracker-v51',
    date: '2026-09-12',
    changes: [
      'Fixed a bug where new database versions could silently wipe your logged sets',
      'Fixed exercise/RIR/RPE pickers not showing while adding an exercise to a workout template',
      'Start the Same Workout now auto-fills values the same way starting from a template does',
      'The workout options popup on the calendar now shows the workout’s name and date',
      'Plan Builder: cleaner layout, a labeled Add Workout Template button, and a dedicated Start button (tapping a template name no longer starts it by accident)',
      'Wipe All Data now reloads the app afterward, matching Load Sample Data and Import All Data',
      'A deleted exercise still referenced by a workout template now shows clearly instead of a raw ID',
      'Startup popups (draft expiry, backup reminder, update notice) now queue instead of ever overlapping',
    ],
  },
  {
    version: 'workout-tracker-v52',
    date: '2026-09-12',
    changes: ['Fixed the exercise list sitting too close to the search bar on "Add Exercise" screens'],
  },
  {
    version: 'workout-tracker-v53',
    date: '2026-09-12',
    changes: [
      'Fixed "Checking for updates…" getting stuck forever (and the Check for Updates button appearing dead) if the update check hung',
    ],
  },
  {
    version: 'workout-tracker-v54',
    date: '2026-09-12',
    changes: [
      'Muscle groups: removed the generic "Back" option, added "Upper Chest" and "Teres"',
    ],
  },
  {
    version: 'workout-tracker-v55',
    date: '2026-09-12',
    changes: [
      'The app now restarts automatically after installing an update, so the new version is actually running right away',
      'Added a "Release Notes" button in Account to see what changed at any time',
      'Fixed several cases where restoring a backup, wiping data, or Dev Tools actions could silently reset your update history, hiding the "What’s New" popup',
    ],
  },
  {
    version: 'workout-tracker-v56',
    date: '2026-09-12',
    changes: ['Muscle group picker is now organized into logical rows instead of one flat list'],
  },
  {
    version: 'workout-tracker-v57',
    date: '2026-09-12',
    changes: [
      'Fixed a bug where an update could report a new version number while still silently running some old files underneath, making it look like the update didn’t actually apply',
    ],
  },
  {
    version: 'workout-tracker-v58',
    date: '2026-09-12',
    changes: [
      '"See Changes" on the update popup will now always show at least something for a real update, instead of occasionally saying there were no changes',
    ],
  },
  {
    version: 'workout-tracker-v59',
    date: '2026-09-12',
    changes: [
      'Added a hidden diagnostic record (Dev Tools → settings) of exactly what the last update check compared, to help track down an update-popup issue without needing console access',
    ],
  },
  {
    version: 'workout-tracker-v60',
    date: '2026-09-12',
    changes: [
      'Fixed a deeper caching issue (the CDN, not just the browser) that could still let an old file slip through even after an update reported the correct new version',
    ],
  },
  {
    version: 'workout-tracker-v61',
    date: '2026-09-12',
    changes: [
      'Fixed "See Changes" showing no changes for a real update — it was comparing against the changelog still loaded from before the update instead of the new one',
    ],
  },
  {
    version: 'workout-tracker-v62',
    date: '2026-09-12',
    changes: [
      'Minor reliability improvement to the update-changes check',
    ],
  },
  {
    version: 'workout-tracker-v63',
    date: '2026-09-12',
    changes: [
      'This is a test entry',
      'Just checking that the update popup shows real content',
      'Another test bullet point',
    ],
  },
  {
    version: 'workout-tracker-v64',
    date: '2026-09-13',
    changes: [
      'Exercise list now shows the metric and effort tracking (e.g. RIR/RPE) alongside the muscle groups',
    ],
  },
  {
    version: 'workout-tracker-v65',
    date: '2026-09-13',
    changes: [
      'Added a new "Rehab" muscle group',
      'Added an Edit button to each exercise during an active workout, opening the same Create/Edit Exercise screen',
    ],
  },
  {
    version: 'workout-tracker-v66',
    date: '2026-09-13',
    changes: [
      'The Edit Exercise screen now explains what\'s safe to change (name, muscle groups, notes) vs. what can make old logged sets display incorrectly (metric, effort tracking)',
      'Changing the metric or effort tracking on an exercise that already has logged sets now asks for confirmation before saving',
    ],
  },
  {
    version: 'workout-tracker-v67',
    date: '2026-09-13',
    changes: [
      'Fixed weight/distance fields rejecting a comma as the decimal separator — some keyboards (notably certain iOS setups) only offer a comma, not a dot',
    ],
  },
  {
    version: 'workout-tracker-v68',
    date: '2026-09-15',
    changes: [
      'Back-related muscle groups now display as "Back (Lats)", "Back (Traps)", "Back (Teres)" for clarity',
    ],
  },
];

/**
 * Every entry strictly after `previousVersion` through and including
 * `newVersion`, matched by array position (versions are opaque strings,
 * never parsed/compared numerically). If `previousVersion` isn't found at
 * all (very first install, or older than anything in this file), returns
 * everything up through `newVersion` — better to show too much than
 * nothing.
 */
function getEntriesBetween(previousVersion, newVersion) {
  const newIndex = CHANGELOG.findIndex((entry) => entry.version === newVersion);
  if (newIndex === -1) return [];

  const previousIndex = CHANGELOG.findIndex((entry) => entry.version === previousVersion);
  let startIndex = previousIndex === -1 ? 0 : previousIndex + 1;

  // Defensive: if previousVersion resolves to the same or a later array
  // position than newVersion (stale/bad tracking data, or the two version
  // strings just don't order the way the caller assumed), never fall
  // through to a blank slice — this function is only ever called after a
  // genuine version transition was already detected, so "nothing to show"
  // is never actually true here. Fall back to at least the new version's
  // own entry rather than an empty result.
  if (startIndex > newIndex) startIndex = newIndex;

  return CHANGELOG.slice(startIndex, newIndex + 1);
}

window.Changelog = { entries: CHANGELOG, getEntriesBetween };

})();
