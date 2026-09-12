'use strict';

/*
 * Account tab: one-tap full-database backup. Export bundles every store
 * (via WorkoutDB.db.exportAll) into a single JSON file; Import fully
 * restores from that file (via WorkoutDB.db.restoreAll — clears every
 * store, then reloads it), so a user can back up/restore everything
 * without ever opening Dev Tools. A file missing any store is rejected
 * before anything is touched, since a partial restore would silently wipe
 * stores the file doesn't account for.
 *
 * Also owns the periodic backup reminder: this app has no server/account
 * system, so a manual Export All Data is the user's only real protection
 * against data loss. checkReminderOnLoad nags every 2 weeks if neither a
 * real export nor a snooze has happened recently — see settings.lastBackupAt
 * / settings.lastBackupReminderDismissedAt below.
 */

(function () {

const REMINDER_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000; // 2 weeks

function getLang() {
  return window.WorkoutI18nState ? window.WorkoutI18nState.get() : window.I18n.DEFAULT_LANGUAGE;
}

function t(key, params) {
  return window.I18n.t(key, getLang(), params);
}

class BackupController {
  constructor() {
    this.exportBtn = document.getElementById('export-backup-btn');
    this.importBtn = document.getElementById('import-backup-btn');

    this.importInput = document.createElement('input');
    this.importInput.type = 'file';
    this.importInput.accept = 'application/json,.json';
    this.importInput.hidden = true;
    this.importInput.addEventListener('change', () => this.handleImportFileSelected());
    document.body.appendChild(this.importInput);

    this.exportBtn.addEventListener('click', () => this.handleExport());
    this.importBtn.addEventListener('click', () => {
      this.importInput.value = '';
      this.importInput.click();
    });
  }

  /** Same share-sheet-first, anchor-download-fallback approach as Dev
   * Tools' per-store export — see devtools.js for why a plain <a download>
   * click can silently fail inside an installed PWA. Marks the backup
   * reminder clock reset on both paths, since either one is a real
   * completed export from the user's point of view (same as Dev Tools not
   * awaiting completion of its download either — there's no stronger
   * "did it actually save" signal available from either API). */
  async handleExport() {
    const payload = await window.WorkoutDB.db.exportAll();
    const filename = `workout-tracker-backup-${payload.exportedAt.slice(0, 10)}.json`;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });

    if (navigator.canShare && navigator.share) {
      const file = new File([blob], filename, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: filename });
          await this.markBackupSuccess();
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') return; // cancelled: not a completed backup
        }
      }
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    await this.markBackupSuccess();
  }

  /** Reads/writes the single 'app' settings record, same pattern as
   * I18n.setLanguage — no dedicated settings-repo abstraction exists yet,
   * so every caller does this get-default-merge-put dance directly. */
  async getSettings() {
    const { db, STORES, CURRENT_SCHEMA_VERSION } = window.WorkoutDB;
    return (await db.get(STORES.settings, 'app')) ?? { key: 'app', schemaVersion: CURRENT_SCHEMA_VERSION };
  }

  async markBackupSuccess() {
    const { db, STORES } = window.WorkoutDB;
    const settings = await this.getSettings();
    settings.lastBackupAt = new Date().toISOString();
    await db.put(STORES.settings, settings);
  }

  async markReminderDismissed() {
    const { db, STORES } = window.WorkoutDB;
    const settings = await this.getSettings();
    settings.lastBackupReminderDismissedAt = new Date().toISOString();
    await db.put(STORES.settings, settings);
  }

  /** Called once on app load, alongside the draft-expiry check
   * (checkExpiryOnLoad in workout.js) — same "nag on open, not on a
   * timer" pattern. Due date is measured from whichever of lastBackupAt /
   * lastBackupReminderDismissedAt is more recent, so a real export OR a
   * snooze both genuinely buy another 2 weeks; only an actual export
   * updates lastBackupAt itself (used if this app ever shows "last backup
   * was N days ago" informationally — snoozing must not be mistaken for
   * having backed up). */
  async checkReminderOnLoad() {
    const settings = await this.getSettings();
    const reference = [settings.lastBackupAt, settings.lastBackupReminderDismissedAt]
      .filter((iso) => iso != null)
      .sort()
      .pop();

    // No reference at all shouldn't happen post-migration (runMigrations
    // seeds lastBackupAt on first run), but if it somehow does, treat the
    // reminder as due rather than crash on `new Date(undefined)`.
    if (reference != null) {
      const age = Date.now() - new Date(reference).getTime();
      if (age < REMINDER_INTERVAL_MS) return;
    }

    const exportNow = await window.WorkoutDialogs.showConfirm({
      title: t('account.backupReminderTitle'),
      message: t('account.backupReminderMessage'),
      confirmText: t('account.backupReminderExportNow'),
      cancelText: t('account.backupReminderLater'),
    });

    if (exportNow) {
      await this.handleExport(); // marks lastBackupAt on success, resetting the clock
    } else {
      await this.markReminderDismissed();
    }
  }

  async handleImportFileSelected() {
    const file = this.importInput.files[0];
    if (!file) return;

    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch (err) {
      await window.WorkoutDialogs.showConfirm({
        title: t('account.backupImportErrorTitle'),
        message: t('account.backupImportParseError'),
        confirmText: t('common.ok'),
        cancelText: '',
      });
      return;
    }

    const { STORES } = window.WorkoutDB;
    // A restore replaces every store, so a file missing even one is
    // rejected outright rather than partially applied — a half-backup
    // (e.g. hand-edited, or an old per-store export from Dev Tools) would
    // otherwise wipe stores it doesn't know about with no record of what
    // was there before.
    const missingStores = Object.values(STORES).filter((storeName) => !Array.isArray(parsed?.[storeName]));
    if (missingStores.length > 0) {
      await window.WorkoutDialogs.showConfirm({
        title: t('account.backupImportErrorTitle'),
        message: t('account.backupImportInvalidFile', { stores: missingStores.join(', ') }),
        confirmText: t('common.ok'),
        cancelText: '',
      });
      return;
    }

    const confirmed = await window.WorkoutDialogs.showConfirm({
      title: t('account.confirmBackupImportTitle'),
      message: t('account.confirmBackupImportMessage'),
      confirmText: t('account.importBackupButton'),
    });
    if (!confirmed) return;

    await window.WorkoutDB.db.restoreAll(parsed);

    await window.WorkoutDialogs.showConfirm({
      title: t('account.backupImportDoneTitle'),
      message: t('account.backupImportDoneMessage'),
      confirmText: t('common.ok'),
      cancelText: '',
    });

    window.location.reload();
  }
}

let controller = null;

function init() {
  controller = new BackupController();
}

async function checkReminderOnLoad() {
  if (!controller) return;
  await controller.checkReminderOnLoad();
}

window.WorkoutBackup = { init, checkReminderOnLoad };

})();
