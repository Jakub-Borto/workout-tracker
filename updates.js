'use strict';

/*
 * Service worker lifecycle: registration, checking for updates, and the
 * safe-activation handshake — a new worker never takes over while a draft
 * workout is active (see sw.js's 'install'/'message' handlers for the
 * other half of this). Also owns the "what's new" popup shown once per
 * genuine version transition, the small on-load/manual update-check status
 * indicator, and the Account tab's "Check for Updates" button — all three
 * are new on top of that same safe-activation mechanism.
 */

(function () {

const STATUS_HIDE_DELAY_MS = 1500;

function getLang() {
  return window.WorkoutI18nState ? window.WorkoutI18nState.get() : window.I18n.DEFAULT_LANGUAGE;
}

function t(key, params) {
  return window.I18n.t(key, getLang(), params);
}

async function getSettings() {
  const { db, STORES, CURRENT_SCHEMA_VERSION } = window.WorkoutDB;
  return (await db.get(STORES.settings, 'app')) ?? { key: 'app', schemaVersion: CURRENT_SCHEMA_VERSION };
}

async function putSettings(settings) {
  const { db, STORES } = window.WorkoutDB;
  await db.put(STORES.settings, settings);
}

let registration = null;
let statusHideTimer = null;

// -- Small non-blocking status indicator -----------------------------------

function showStatus(text) {
  clearTimeout(statusHideTimer);
  const el = document.getElementById('update-status-indicator');
  const textEl = document.getElementById('update-status-text');
  textEl.textContent = text;
  el.hidden = false;
}

function hideStatusSoon(delay = STATUS_HIDE_DELAY_MS) {
  clearTimeout(statusHideTimer);
  statusHideTimer = setTimeout(() => {
    document.getElementById('update-status-indicator').hidden = true;
  }, delay);
}

// -- Safe activation handshake ----------------------------------------------

/** If a new worker is sitting there waiting and no draft is currently
 * active, tell it it's safe to take over now. A no-op if there's nothing
 * waiting or a workout is in progress — in which case it just stays
 * waiting until the next time this is called (next app load, or the next
 * manual/automatic update check) finds no draft active. */
async function maybeActivateWaiting() {
  if (!registration) return;
  const waitingWorker = registration.waiting;
  if (!waitingWorker) return;

  const draft = await window.WorkoutRepo.getDraft();
  if (draft) return;

  // The waiting worker's state can change while the getDraft() lookup
  // above was in flight (e.g. it already activated on its own, as can
  // happen on a first-ever install with no prior controller to wait on) —
  // re-check right before posting rather than trusting the reference taken
  // before the await.
  if (registration.waiting !== waitingWorker) return;
  waitingWorker.postMessage({ type: 'SKIP_WAITING' });
}

function watchInstallingWorker(worker) {
  showStatus(t('updates.downloading'));
  worker.addEventListener('statechange', () => {
    if (worker.state === 'installed') {
      hideStatusSoon(200);
      maybeActivateWaiting();
    }
  });
}

const UPDATE_CHECK_TIMEOUT_MS = 10000;

/** Shared by the automatic on-load check and the manual "Check for
 * Updates" button — exactly the same code path either way. */
async function checkForUpdate() {
  if (!registration) return;
  showStatus(t('updates.checking'));

  try {
    // registration.update() has a history of just hanging forever on some
    // mobile browsers (notably older iOS Safari) instead of rejecting —
    // without a timeout, a hang there means the "Checking for updates…"
    // status is stuck on screen permanently and the manual button looks
    // completely dead, since it's still "waiting" on the previous call.
    // Race it against a timeout so the UI always recovers either way.
    await Promise.race([
      registration.update(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('update() timed out')), UPDATE_CHECK_TIMEOUT_MS)),
    ]);
  } catch (err) {
    console.error('Update check failed', err);
  }

  // If a new version was found, the 'updatefound' listener (set up once at
  // registration time) already picked it up and is showing "Downloading
  // update…" itself. If not, there's nothing installing — just fade the
  // "Checking…" message quietly rather than announcing "up to date".
  if (!registration.installing) hideStatusSoon();

  await maybeActivateWaiting();
}

/** Persists what the most recent activation actually computed, directly
 * onto the settings object the caller is about to save — viewable via Dev
 * Tools → settings on any device (including an installed PWA with no
 * console access) without needing anything else added to the UI. */
function recordUpdateDebug(settings, { previousVersion, newVersion, entryCount, skipped }) {
  settings.lastUpdateDebug = {
    at: new Date().toISOString(),
    previousVersion,
    newVersion,
    entryCount,
    skipped, // true = the "nothing to announce" branch was taken, popup never shown
    changelogLength: window.Changelog ? window.Changelog.entries.length : null,
  };
}

/** See the call site in handleActivated for why this is necessary. Fetches
 * the plain (non-busted) changelog.js URL — which by this point in the
 * service worker lifecycle is already the freshly precached new version —
 * and re-executes it, which re-runs its IIFE and reassigns window.Changelog
 * in place. */
async function refreshChangelogModule() {
  try {
    const res = await fetch('./changelog.js');
    const code = await res.text();
    // eslint-disable-next-line no-eval
    (0, eval)(code);
  } catch (err) {
    console.error('Failed to refresh changelog module before computing update diff', err);
  }
}

// -- "What's new" popup, shown once per genuine version transition --------

async function handleActivated(newVersion) {
  const settings = await getSettings();
  const previousVersion = settings.lastKnownAppVersion ?? null;

  if (previousVersion == null || previousVersion === newVersion) {
    // Nothing to announce: either this is the first version we've ever
    // recorded (fresh install — nothing to compare against) or this
    // message is reporting the version we already know about.
    settings.lastKnownAppVersion = newVersion;
    recordUpdateDebug(settings, { previousVersion, newVersion, entryCount: null, skipped: true });
    await putSettings(settings);
    return;
  }

  settings.lastKnownAppVersion = newVersion;

  // The page executing this code right now loaded changelog.js at page-load
  // time, under the OLD service worker version — activation only changes
  // which file is served for *future* requests, it never re-runs scripts
  // already parsed into this page. So window.Changelog here can never
  // contain an entry for the version that's activating right now (that
  // entry only exists in the new file), which made every real transition
  // compute zero entries. Re-fetch and re-execute changelog.js immediately
  // before diffing — this hits the exact same precached copy sw.js's
  // 'install' step already wrote fresh under the plain URL, so
  // window.Changelog is swapped to the real, current data first.
  await refreshChangelogModule();

  // Queued rather than shown directly — this fires from an async
  // service-worker message that can land at any moment, completely
  // independent of the draft-expiry/backup-reminder startup sequence in
  // app.js, so without this it could pop up on top of (or invisibly
  // behind) one of those. window.WorkoutDialogs.runExclusive (workout.js)
  // is the shared queue all three use.
  const entries = window.Changelog.getEntriesBetween(previousVersion, newVersion);

  // Diagnostic trail, persisted (not just console.log'd) — this popup has
  // been hard to debug after the fact, and on an installed/homescreen PWA
  // there's often no way to reach a console at all. Written into the same
  // 'app' settings record Dev Tools already dumps raw, so checking Dev
  // Tools → settings on any device, phone included, shows exactly what the
  // last transition actually computed.
  recordUpdateDebug(settings, { previousVersion, newVersion, entryCount: entries.length, skipped: false });
  await putSettings(settings);

  await window.WorkoutDialogs.runExclusive(() => showUpdatePopup(entries));

  // The page that's been running this whole time was loaded under the OLD
  // code — activation only swaps which files the service worker hands out
  // for *future* requests, it doesn't retroactively change what's already
  // executing. Reload now so the new code is actually the thing running,
  // not just installed. Safe to do unconditionally here: activation itself
  // only ever happens when no draft is active (see sw.js/maybeActivateWaiting),
  // so there's nothing in-progress to lose.
  window.location.reload();
}

/** Resolves once the user is fully done with the update popup — including
 * the "See Changes" screen, if they opened it — so the popup queue holds
 * the next queued popup back for the whole interaction, not just the
 * first tap. */
function showUpdatePopup(entries) {
  return new Promise((resolve) => {
    const backdrop = document.getElementById('update-popup-dialog');
    const okBtn = document.getElementById('update-popup-ok-btn');
    const changesBtn = document.getElementById('update-popup-changes-btn');

    backdrop.hidden = false;

    function cleanup() {
      backdrop.hidden = true;
      okBtn.removeEventListener('click', onOk);
      changesBtn.removeEventListener('click', onChanges);
    }
    function onOk() {
      cleanup();
      resolve();
    }
    async function onChanges() {
      cleanup();
      await showChangesScreen(entries);
      resolve();
    }
    okBtn.addEventListener('click', onOk);
    changesBtn.addEventListener('click', onChanges);
  });
}

/** Renders `entries` (oldest first, same shape as changelog.js) into the
 * "What's New" screen — reused both for the post-update popup's "See
 * Changes" (a specific version range) and the Account tab's always-available
 * "Release Notes" button (the full changelog), so there's one rendering
 * path for both. */
function showChangesScreen(entries) {
  const overlay = document.getElementById('update-changes-screen');
  const contentEl = document.getElementById('update-changes-content');
  const closeBtn = document.getElementById('update-changes-close-btn');

  contentEl.innerHTML = '';

  if (entries.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty-state-subtitle';
    p.textContent = t('updates.noChangesFallback');
    contentEl.appendChild(p);
  } else {
    entries.forEach((entry) => {
      const heading = document.createElement('h3');
      heading.className = 'update-changes-version-heading';
      const displayVersion = entry.version.replace(/^workout-tracker-/, '');
      heading.textContent = entry.date ? `${displayVersion} — ${entry.date}` : displayVersion;
      contentEl.appendChild(heading);

      const list = document.createElement('ul');
      list.className = 'update-changes-list';
      entry.changes.forEach((change) => {
        const li = document.createElement('li');
        li.textContent = change;
        list.appendChild(li);
      });
      contentEl.appendChild(list);
    });
  }

  overlay.hidden = false;

  return new Promise((resolve) => {
    function onClose() {
      overlay.hidden = true;
      closeBtn.removeEventListener('click', onClose);
      resolve();
    }
    closeBtn.addEventListener('click', onClose);
  });
}

// -- Bootstrap ---------------------------------------------------------

function registerServiceWorker() {
  navigator.serviceWorker
    .register('sw.js')
    .then((reg) => {
      registration = reg;
      registration.addEventListener('updatefound', () => {
        if (registration.installing) watchInstallingWorker(registration.installing);
      });
      // A worker may already be waiting from an earlier visit that ended
      // with a draft still active — safe to retry now.
      maybeActivateWaiting();
      checkForUpdate();
    })
    .catch((err) => {
      console.error('Service worker registration failed', err);
    });
}

// Registration deliberately happens right here, at module-load time —
// NOT inside init() (which app.js only calls after several `await`s in its
// own bootstrap: db.open(), runMigrations(), I18n.getLanguage()). Waiting
// for those first means the page's own 'load' event can easily fire
// *before* init() ever gets to attach a 'load' listener, in which case the
// listener would never fire and the service worker would silently never
// register. Checking document.readyState directly here (evaluated
// synchronously as this script parses, long before any of those awaits)
// avoids that race entirely — same guarantee the original inline
// registration snippet in app.js had before this logic moved here.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'ACTIVATED') handleActivated(event.data.version);
  });

  if (document.readyState === 'complete') {
    registerServiceWorker();
  } else {
    window.addEventListener('load', registerServiceWorker);
  }
}

function init() {
  const checkBtn = document.getElementById('check-for-updates-btn');
  if (checkBtn) checkBtn.addEventListener('click', () => checkForUpdate());

  // Always available regardless of update-transition state — the "what's
  // new" popup only ever fires around an actual detected version change,
  // which can be silently skipped (e.g. a full data restore from a backup
  // that predates lastKnownAppVersion resets that tracking). This is the
  // reliable fallback: shows the whole changelog, oldest first, any time.
  const releaseNotesBtn = document.getElementById('view-release-notes-btn');
  if (releaseNotesBtn) releaseNotesBtn.addEventListener('click', () => showChangesScreen(window.Changelog.entries));
}

window.WorkoutUpdates = { init, checkForUpdate };

})();
