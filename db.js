'use strict';

/*
 * IndexedDB data layer.
 * Object stores:
 *  - exercises    : { id, name, muscleGroups, metrics, effortTracking, notes, schemaVersion }
 *  - workouts     : { id, name, date (ISO yyyy-mm-dd), schemaVersion } — finished workouts only
 *  - sets         : { set_id, exercise_id, workout_id, set_number, is_warmup_set, input_1, input_2, rir, rpe, notes, schemaVersion }
 *  - exerciseNotes: { id, exercise_id, workout_id, text, schemaVersion } — history-preserving, one per exercise per workout
 *  - draftWorkout : single record keyed 'current' holding the in-progress workout (see workout.js); not permanent history
 *  - bodyweights  : { id, date, weight, schemaVersion }
 *  - settings     : single record keyed 'app' holding { schemaVersion, ... }
 *
 * Schema versioning: every record carries schemaVersion. Readers must never
 * assume a field exists beyond the stable core fields; use `?? default`.
 * migrateRecord()/runMigrations() below is the scaffold for upgrading old
 * records when CURRENT_SCHEMA_VERSION increases in a future build.
 */

(function () {

const DB_NAME = 'workout-tracker';
const DB_VERSION = 5;
const CURRENT_SCHEMA_VERSION = 1;

const STORES = {
  exercises: 'exercises',
  workouts: 'workouts',
  sets: 'sets',
  exerciseNotes: 'exerciseNotes',
  draftWorkout: 'draftWorkout',
  bodyweights: 'bodyweights',
  settings: 'settings',
  gyms: 'gyms',
  personalRecords: 'personalRecords',
};

const GENERAL_GYM_ID = 'general';

class Database {
  constructor() {
    this._db = null;
    this._ready = null;
  }

  open() {
    if (this._ready) return this._ready;

    this._ready = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains(STORES.exercises)) {
          const store = db.createObjectStore(STORES.exercises, { keyPath: 'id' });
          store.createIndex('name', 'name', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.workouts)) {
          const store = db.createObjectStore(STORES.workouts, { keyPath: 'id' });
          store.createIndex('date', 'date', { unique: false });
        }

        // WorkoutSet's primary key/shape changed (id -> set_id) when this
        // segment was added; drop and recreate rather than migrate values,
        // since no released data depends on the old shape yet.
        if (db.objectStoreNames.contains(STORES.sets)) {
          db.deleteObjectStore(STORES.sets);
        }
        {
          const store = db.createObjectStore(STORES.sets, { keyPath: 'set_id' });
          store.createIndex('workout_id', 'workout_id', { unique: false });
          store.createIndex('exercise_id', 'exercise_id', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.exerciseNotes)) {
          const store = db.createObjectStore(STORES.exerciseNotes, { keyPath: 'id' });
          store.createIndex('exercise_id', 'exercise_id', { unique: false });
          store.createIndex('workout_id', 'workout_id', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.draftWorkout)) {
          db.createObjectStore(STORES.draftWorkout, { keyPath: 'id' });
        }

        if (!db.objectStoreNames.contains(STORES.bodyweights)) {
          const store = db.createObjectStore(STORES.bodyweights, { keyPath: 'id' });
          store.createIndex('date', 'date', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.settings)) {
          db.createObjectStore(STORES.settings, { keyPath: 'key' });
        }

        if (!db.objectStoreNames.contains(STORES.gyms)) {
          const store = db.createObjectStore(STORES.gyms, { keyPath: 'id' });
          store.createIndex('name', 'name', { unique: false });
        }

        // Keyed by the deterministic `${exercise_id}::${gym_id}` pair (see
        // PersonalRecord in models.js), so no secondary index is needed.
        if (!db.objectStoreNames.contains(STORES.personalRecords)) {
          db.createObjectStore(STORES.personalRecords, { keyPath: 'id' });
        }
      };

      request.onsuccess = (event) => {
        this._db = event.target.result;
        resolve(this._db);
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });

    return this._ready;
  }

  async _tx(storeNames, mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeNames, mode);
      const stores = Array.isArray(storeNames)
        ? storeNames.map((n) => tx.objectStore(n))
        : tx.objectStore(storeNames);
      let result;
      Promise.resolve(fn(stores, tx))
        .then((r) => { result = r; })
        .catch(reject);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  _reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async put(storeName, record) {
    return this._tx(storeName, 'readwrite', (store) => this._reqToPromise(store.put(record)));
  }

  async get(storeName, id) {
    return this._tx(storeName, 'readonly', (store) => this._reqToPromise(store.get(id)));
  }

  async getAll(storeName) {
    return this._tx(storeName, 'readonly', (store) => this._reqToPromise(store.getAll()));
  }

  async getAllByIndex(storeName, indexName, value) {
    return this._tx(storeName, 'readonly', (store) =>
      this._reqToPromise(store.index(indexName).getAll(value))
    );
  }

  async delete(storeName, id) {
    return this._tx(storeName, 'readwrite', (store) => this._reqToPromise(store.delete(id)));
  }

  async clear(storeName) {
    return this._tx(storeName, 'readwrite', (store) => this._reqToPromise(store.clear()));
  }

  /** Dump every store to a plain object, for JSON export (future segment). */
  async exportAll() {
    const out = { schemaVersion: CURRENT_SCHEMA_VERSION, exportedAt: new Date().toISOString() };
    for (const storeName of Object.values(STORES)) {
      out[storeName] = await this.getAll(storeName);
    }
    return out;
  }

  /** Load a plain object (as produced by exportAll) back into the database (future segment). */
  async importAll(data) {
    for (const storeName of Object.values(STORES)) {
      const records = data[storeName];
      if (!Array.isArray(records)) continue;
      for (const record of records) {
        await this.put(storeName, migrateRecord(record));
      }
    }
  }

  /** Full restore: clears every store first, then loads `data` (as produced
   * by exportAll) in. Unlike importAll (an upsert that leaves anything not
   * in `data` untouched), this makes the database an exact match for the
   * backup — anything created/changed since the backup was taken is gone. */
  async restoreAll(data) {
    for (const storeName of Object.values(STORES)) {
      await this.clear(storeName);
    }
    await this.importAll(data);
  }
}

/**
 * Migration scaffold: brings a record from whatever schemaVersion it was
 * saved with up to CURRENT_SCHEMA_VERSION. No-op today; future segments add
 * `if (record.schemaVersion < N) { ...upgrade...; record.schemaVersion = N; }`
 * steps here so old historical data keeps loading correctly.
 */
function migrateRecord(record) {
  if (!record || typeof record !== 'object') return record;
  const migrated = { ...record };
  if (migrated.schemaVersion == null) migrated.schemaVersion = 1;
  // Future version upgrade steps go here, e.g.:
  // if (migrated.schemaVersion < 2) { migrated.rpe = migrated.rpe ?? null; migrated.schemaVersion = 2; }
  return migrated;
}

async function runMigrations(db) {
  const settings = (await db.get(STORES.settings, 'app')) ?? {
    key: 'app',
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };

  if (settings.schemaVersion == null || settings.schemaVersion < CURRENT_SCHEMA_VERSION) {
    // Future: iterate stores and re-save migrateRecord(record) for each.
    settings.schemaVersion = CURRENT_SCHEMA_VERSION;
  }

  // Seed lastBackupAt to "now" the first time this field is missing — both
  // a brand new install (nothing worth backing up yet) and an upgrade from
  // a version before this field existed (no real backup history to report)
  // get a fresh 2-week grace period instead of being nagged immediately.
  if (settings.lastBackupAt == null) {
    settings.lastBackupAt = new Date().toISOString();
  }

  await db.put(STORES.settings, settings);

  // Every install must have the always-present "General" gym (id fixed so
  // it can be relied on as a sentinel elsewhere, e.g. WorkoutSet.gym_id).
  const generalGym = await db.get(STORES.gyms, GENERAL_GYM_ID);
  if (!generalGym) {
    await db.put(STORES.gyms, { id: GENERAL_GYM_ID, name: 'General', schemaVersion: CURRENT_SCHEMA_VERSION });
  }

  return settings;
}

function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const db = new Database();

window.WorkoutDB = {
  db,
  STORES,
  CURRENT_SCHEMA_VERSION,
  migrateRecord,
  runMigrations,
  generateId,
  GENERAL_GYM_ID,
};

})();
