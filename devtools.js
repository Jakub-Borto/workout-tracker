'use strict';

/*
 * Dev Tools screen: a raw read-only view into every IndexedDB store,
 * including the temporary draft workout store, for debugging. Reads
 * directly via window.WorkoutDB.db so it shows exactly what's persisted,
 * independent of any model-class defaulting.
 */

(function () {

function getLang() {
  return window.WorkoutI18nState ? window.WorkoutI18nState.get() : window.I18n.DEFAULT_LANGUAGE;
}

function t(key, params) {
  return window.I18n.t(key, getLang(), params);
}

function randomConfirmCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * Type-to-confirm dialog for destructive Dev Tools actions: shows a random
 * code the user must retype exactly before the delete proceeds. Resolves
 * true only on an exact match; any cancel/backdrop click resolves false.
 */
function showDangerConfirm({ title, message }) {
  const backdrop = document.getElementById('danger-confirm-dialog');
  const titleEl = document.getElementById('danger-confirm-title');
  const messageEl = document.getElementById('danger-confirm-message');
  const codeEl = document.getElementById('danger-confirm-code');
  const input = document.getElementById('danger-confirm-input');
  const errorEl = document.getElementById('danger-confirm-error');
  const okBtn = document.getElementById('danger-confirm-ok-btn');
  const cancelBtn = document.getElementById('danger-confirm-cancel-btn');

  const code = randomConfirmCode();
  titleEl.textContent = title;
  messageEl.textContent = message;
  codeEl.textContent = code;
  input.value = '';
  errorEl.hidden = true;
  backdrop.hidden = false;
  input.focus();

  return new Promise((resolve) => {
    function cleanup(result) {
      backdrop.hidden = true;
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      backdrop.removeEventListener('click', onBackdrop);
      resolve(result);
    }
    function onOk() {
      if (input.value.trim().toUpperCase() !== code) {
        errorEl.textContent = t('devtools.codeMismatch');
        errorEl.hidden = false;
        input.focus();
        return;
      }
      cleanup(true);
    }
    function onCancel() {
      cleanup(false);
    }
    function onBackdrop(e) {
      if (e.target === backdrop) cleanup(false);
    }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    backdrop.addEventListener('click', onBackdrop);
  });
}

class DevToolsController {
  constructor() {
    this.overlay = document.getElementById('dev-tools-screen');
    this.contentEl = document.getElementById('dev-tools-content');
    this.closeBtn = document.getElementById('dev-tools-close-btn');
    this.refreshBtn = document.getElementById('dev-tools-refresh-btn');
    this.openBtn = document.getElementById('open-dev-tools-btn');

    this.expanded = new Set();

    this.wipeAllBtn = document.getElementById('devtools-wipe-all-btn');

    // One hidden file input, reused for every store's Import button — which
    // store a picked file goes into is tracked in this.importTarget between
    // the click that opens the picker and the resulting 'change' event.
    this.importInput = document.createElement('input');
    this.importInput.type = 'file';
    this.importInput.accept = 'application/json,.json';
    this.importInput.hidden = true;
    this.importInput.addEventListener('change', () => this.handleImportFileSelected());
    document.body.appendChild(this.importInput);
    this.importTarget = null;

    this.openBtn.addEventListener('click', () => this.open());
    this.closeBtn.addEventListener('click', () => this.close());
    this.refreshBtn.addEventListener('click', () => this.render());
    this.wipeAllBtn.addEventListener('click', () => this.handleWipeAll());

    window.addEventListener('app:languagechange', () => {
      if (!this.overlay.hidden) this.render();
    });
  }

  async open() {
    this.overlay.hidden = false;
    await this.render();
  }

  close() {
    this.overlay.hidden = true;
  }

  async render() {
    const { db, STORES } = window.WorkoutDB;
    this.contentEl.innerHTML = '';

    const storeNames = Object.keys(STORES);
    const entries = await Promise.all(
      storeNames.map(async (key) => ({ key, storeName: STORES[key], records: await db.getAll(STORES[key]) }))
    );

    entries.forEach(({ key, storeName, records }) => {
      this.contentEl.appendChild(this.buildStoreCard(key, storeName, records));
    });
  }

  buildStoreCard(key, storeName, records) {
    const card = document.createElement('div');
    card.className = 'devtools-store';
    if (this.expanded.has(storeName)) card.classList.add('is-expanded');

    const header = document.createElement('div');
    header.className = 'devtools-store-header';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'devtools-store-toggle';

    const name = document.createElement('span');
    name.className = 'devtools-store-name';
    name.textContent = window.I18n.t(`devtools.store.${key}`, getLang());
    if (name.textContent === `devtools.store.${key}`) name.textContent = storeName;

    const count = document.createElement('span');
    count.className = 'devtools-store-count';
    count.textContent = String(records.length);

    const chevron = document.createElement('span');
    chevron.className = 'devtools-store-chevron';
    chevron.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    toggle.append(name, count, chevron);
    toggle.addEventListener('click', () => {
      if (this.expanded.has(storeName)) this.expanded.delete(storeName);
      else this.expanded.add(storeName);
      card.classList.toggle('is-expanded');
      body.hidden = !this.expanded.has(storeName);
    });

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'devtools-store-icon-btn';
    exportBtn.setAttribute('aria-label', t('devtools.exportStore'));
    exportBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    exportBtn.addEventListener('click', () => this.handleExportStore(key, storeName));

    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'devtools-store-icon-btn';
    importBtn.setAttribute('aria-label', t('devtools.importStore'));
    importBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 15V4m0 0l-4 4m4-4l4 4M5 19h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    importBtn.addEventListener('click', () => this.handleImportStoreClick(key, storeName));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'devtools-store-icon-btn devtools-store-delete-btn';
    deleteBtn.setAttribute('aria-label', t('devtools.deleteStore'));
    deleteBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    deleteBtn.addEventListener('click', () => this.handleDeleteStore(key, storeName));

    header.append(toggle, exportBtn, importBtn, deleteBtn);

    const body = document.createElement('div');
    body.className = 'devtools-store-body';
    body.hidden = !this.expanded.has(storeName);

    if (storeName === window.WorkoutDB.STORES.draftWorkout) {
      const note = document.createElement('p');
      note.className = 'devtools-draft-note';
      note.textContent = t('devtools.draftNote');
      body.appendChild(note);
    }

    const pre = document.createElement('pre');
    pre.textContent = records.length === 0 ? t('devtools.empty') : JSON.stringify(records, null, 2);
    body.appendChild(pre);

    card.append(header, body);
    return card;
  }

  async handleDeleteStore(key, storeName) {
    const label = window.I18n.t(`devtools.store.${key}`, getLang());
    const confirmed = await showDangerConfirm({
      title: t('devtools.confirmDeleteStoreTitle', { name: label }),
      message: t('devtools.confirmDeleteStoreMessage', { name: label }),
    });
    if (!confirmed) return;

    await window.WorkoutDB.db.clear(storeName);
    await this.render();
  }

  /** Exports every record in this store as a standalone JSON file, so a
   * single store can be backed up/inspected/moved without touching the
   * others. Reads raw via db.getAll, same as the rest of this screen.
   *
   * A plain `<a download>` click is unreliable as a PWA installed on a
   * phone: an installed iOS app runs in a standalone webview with no
   * browser chrome to catch a download, so the click can silently do
   * nothing (or just navigate to a blob: URL with no way to save it).
   * Android's installed/TWA mode can be similarly inconsistent. The fix
   * both platforms actually support is the Web Share API's file sharing —
   * it hands the file to the native share sheet, where "Save to Files" /
   * Drive / AirDrop/etc. all work. Desktop browsers commonly lack
   * file-sharing support (`canShare` returns false there), so they fall
   * back to the normal anchor download, which works fine outside a
   * standalone shell. */
  async handleExportStore(key, storeName) {
    const records = await window.WorkoutDB.db.getAll(storeName);
    const payload = {
      store: storeName,
      exportedAt: new Date().toISOString(),
      schemaVersion: window.WorkoutDB.CURRENT_SCHEMA_VERSION,
      records,
    };

    const filename = `${storeName}.json`;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });

    if (navigator.canShare && navigator.share) {
      const file = new File([blob], filename, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: filename });
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') return; // user cancelled the share sheet
          // Any other failure: fall through and try the plain download instead.
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
  }

  /** Opens the shared file picker; handleImportFileSelected does the actual
   * work once a file comes back, since <input type="file"> only fires its
   * 'change' event asynchronously. */
  handleImportStoreClick(key, storeName) {
    this.importTarget = { key, storeName };
    this.importInput.value = '';
    this.importInput.click();
  }

  /** Accepts either a raw JSON array of records or an export file shaped
   * like handleExportStore's output (`{ records: [...] }`). Every record is
   * put()'t through migrateRecord — an upsert, so a record whose id matches
   * an existing one overwrites it, and everything else in the store is left
   * alone (unlike the destructive per-store Delete button). */
  async handleImportFileSelected() {
    const file = this.importInput.files[0];
    const target = this.importTarget;
    this.importTarget = null;
    if (!file || !target) return;

    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch (err) {
      await window.WorkoutDialogs.showConfirm({
        title: t('devtools.importErrorTitle'),
        message: t('devtools.importParseError'),
        confirmText: t('common.ok'),
        cancelText: '',
      });
      return;
    }

    const records = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.records) ? parsed.records : null;
    if (!records) {
      await window.WorkoutDialogs.showConfirm({
        title: t('devtools.importErrorTitle'),
        message: t('devtools.importInvalidFile'),
        confirmText: t('common.ok'),
        cancelText: '',
      });
      return;
    }

    const label = window.I18n.t(`devtools.store.${target.key}`, getLang());
    const confirmed = await window.WorkoutDialogs.showConfirm({
      title: t('devtools.confirmImportTitle', { name: label }),
      message: t('devtools.confirmImportMessage', { name: label, count: records.length }),
      confirmText: t('devtools.importButton'),
    });
    if (!confirmed) return;

    for (const record of records) {
      await window.WorkoutDB.db.put(target.storeName, window.WorkoutDB.migrateRecord(record));
    }
    await this.render();
  }

  async handleWipeAll() {
    const confirmed = await showDangerConfirm({
      title: t('devtools.confirmWipeAllTitle'),
      message: t('devtools.confirmWipeAllMessage'),
    });
    if (!confirmed) return;

    const { db, STORES } = window.WorkoutDB;
    for (const storeName of Object.values(STORES)) {
      await db.clear(storeName);
    }
    await this.render();
  }
}

let controller = null;

function init() {
  controller = new DevToolsController();
}

window.WorkoutDevTools = { init };

})();
