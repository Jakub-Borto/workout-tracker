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

/** Shared by the automatic on-load check and the manual "Check for
 * Updates" button — exactly the same code path either way. */
async function checkForUpdate() {
  if (!registration) return;
  showStatus(t('updates.checking'));

  try {
    await registration.update();
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

// -- "What's new" popup, shown once per genuine version transition --------

async function handleActivated(newVersion) {
  const settings = await getSettings();
  const previousVersion = settings.lastKnownAppVersion ?? null;

  if (previousVersion == null || previousVersion === newVersion) {
    // Nothing to announce: either this is the first version we've ever
    // recorded (fresh install — nothing to compare against) or this
    // message is reporting the version we already know about.
    settings.lastKnownAppVersion = newVersion;
    await putSettings(settings);
    return;
  }

  settings.lastKnownAppVersion = newVersion;
  await putSettings(settings);

  // Queued rather than shown directly — this fires from an async
  // service-worker message that can land at any moment, completely
  // independent of the draft-expiry/backup-reminder startup sequence in
  // app.js, so without this it could pop up on top of (or invisibly
  // behind) one of those. window.WorkoutDialogs.runExclusive (workout.js)
  // is the shared queue all three use.
  await window.WorkoutDialogs.runExclusive(() => showUpdatePopup(previousVersion, newVersion));
}

/** Resolves once the user is fully done with the update popup — including
 * the "See Changes" screen, if they opened it — so the popup queue holds
 * the next queued popup back for the whole interaction, not just the
 * first tap. */
function showUpdatePopup(previousVersion, newVersion) {
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
      await showChangesScreen(previousVersion, newVersion);
      resolve();
    }
    okBtn.addEventListener('click', onOk);
    changesBtn.addEventListener('click', onChanges);
  });
}

function showChangesScreen(previousVersion, newVersion) {
  const overlay = document.getElementById('update-changes-screen');
  const contentEl = document.getElementById('update-changes-content');
  const closeBtn = document.getElementById('update-changes-close-btn');

  const entries = window.Changelog.getEntriesBetween(previousVersion, newVersion);
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
}

window.WorkoutUpdates = { init, checkForUpdate };

})();
