import { TimerEngine } from "./timer-engine.js";

const DATABASE_NAME = "throwdown-timer";
const DATABASE_VERSION = 1;
const STORE_NAME = "workouts";

export class WorkoutRepositoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WorkoutRepositoryError";
    this.code = code;
  }
}

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function validateWorkout(wod) {
  if (!wod || typeof wod !== "object" || Array.isArray(wod)) {
    throw new WorkoutRepositoryError("INVALID_WOD", "El WOD debe ser un objeto.");
  }
  if (wod.schemaVersion !== 1) {
    throw new WorkoutRepositoryError("UNSUPPORTED_SCHEMA", "Solo se pueden guardar WODs con schemaVersion 1.");
  }
  if (typeof wod.title !== "string" || !wod.title.trim()) {
    throw new WorkoutRepositoryError("INVALID_TITLE", "El WOD necesita un título.");
  }
  if (!wod.workout || typeof wod.workout !== "object" ||
      typeof wod.workout.format !== "string" || !Array.isArray(wod.workout.movements)) {
    throw new WorkoutRepositoryError("INVALID_WORKOUT", "La descripción y los movimientos del WOD no son válidos.");
  }
  if (!wod.interpretation || !["ready", "needs_review", "invalid"].includes(wod.interpretation.status) ||
      !Array.isArray(wod.interpretation.issues)) {
    throw new WorkoutRepositoryError("INVALID_INTERPRETATION", "El estado de interpretación del WOD no es válido.");
  }
  if (wod.timer !== null) {
    try {
      new TimerEngine(wod.timer, { now: () => 0 });
    } catch (error) {
      throw new WorkoutRepositoryError("INVALID_TIMER", `El plan del temporizador no es válido: ${error.message}`);
    }
  }
  if (wod.interpretation.status === "ready" && wod.timer === null) {
    throw new WorkoutRepositoryError("INVALID_READY_WOD", "Un WOD listo para ejecutar necesita un plan de temporizador.");
  }
  if (wod.interpretation.status === "ready" &&
      wod.interpretation.issues.some(issue => issue && issue.severity === "blocking")) {
    throw new WorkoutRepositoryError("BLOCKING_ISSUES", "Un WOD con incidencias bloqueantes no puede marcarse como listo.");
  }
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Error de IndexedDB."));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("La transacción de IndexedDB se ha cancelado."));
    transaction.onerror = () => reject(transaction.error || new Error("Error en la transacción de IndexedDB."));
  });
}

/** Native IndexedDB adapter. The repository accepts an adapter so its domain behavior is testable without a browser. */
export function createIndexedDBStorage({
  indexedDB = globalThis.indexedDB,
  databaseName = DATABASE_NAME
} = {}) {
  if (!indexedDB) {
    throw new WorkoutRepositoryError("INDEXEDDB_UNAVAILABLE", "Este navegador no ofrece IndexedDB.");
  }

  let databasePromise;
  function openDatabase() {
    if (!databasePromise) {
      databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName, DATABASE_VERSION);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(STORE_NAME)) {
            const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
            store.createIndex("updatedAt", "updatedAt", { unique: false });
          }
        };
        request.onsuccess = () => {
          const database = request.result;
          database.onversionchange = () => database.close();
          resolve(database);
        };
        request.onerror = () => reject(request.error || new Error("No se pudo abrir la base de datos."));
        request.onblocked = () => reject(new Error("La base de datos está bloqueada por otra pestaña."));
      }).catch(error => {
        databasePromise = null;
        throw new WorkoutRepositoryError("DATABASE_OPEN_FAILED", error.message);
      });
    }
    return databasePromise;
  }

  async function run(mode, operation) {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    let result;
    try {
      result = operation(store);
    } catch (error) {
      transaction.abort();
      throw error;
    }
    const done = transactionDone(transaction);
    const value = result && typeof result.then === "function" ? await result : result;
    await done;
    return value;
  }

  return {
    getAll: () => run("readonly", store => requestResult(store.getAll())),
    get: id => run("readonly", store => requestResult(store.get(id))),
    put: record => run("readwrite", store => requestResult(store.put(clone(record)))),
    delete: id => run("readwrite", store => requestResult(store.delete(id)))
  };
}

export function createWorkoutRepository({
  storage = createIndexedDBStorage(),
  now = () => new Date().toISOString(),
  uuid = () => globalThis.crypto.randomUUID()
} = {}) {
  if (!storage || !["getAll", "get", "put", "delete"].every(method => typeof storage[method] === "function")) {
    throw new WorkoutRepositoryError("INVALID_STORAGE", "El adaptador de almacenamiento está incompleto.");
  }

  function makeRecord(wod, metadata = {}) {
    validateWorkout(wod);
    const timestamp = now();
    return {
      id: metadata.id || uuid(),
      schemaVersion: wod.schemaVersion,
      title: wod.title.trim(),
      sourceText: typeof wod.sourceText === "string" ? wod.sourceText : null,
      workout: clone(wod.workout),
      timer: wod.timer === null ? null : clone(wod.timer),
      interpretation: clone(wod.interpretation),
      createdAt: metadata.createdAt || timestamp,
      updatedAt: timestamp
    };
  }

  return {
    async list() {
      const records = await storage.getAll();
      return records.map(clone).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async get(id) {
      if (typeof id !== "string" || !id) return null;
      const record = await storage.get(id);
      return record ? clone(record) : null;
    },

    async create(wod) {
      const record = makeRecord(wod);
      await storage.put(record);
      return clone(record);
    },

    async update(id, changes) {
      const existing = await storage.get(id);
      if (!existing) throw new WorkoutRepositoryError("NOT_FOUND", "No se ha encontrado el WOD que quieres editar.");
      if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
        throw new WorkoutRepositoryError("INVALID_CHANGES", "Los cambios del WOD no son válidos.");
      }
      const candidate = {
        schemaVersion: existing.schemaVersion,
        title: changes.title ?? existing.title,
        sourceText: changes.sourceText === undefined ? existing.sourceText : changes.sourceText,
        workout: changes.workout ?? existing.workout,
        timer: changes.timer === undefined ? existing.timer : changes.timer,
        interpretation: changes.interpretation ?? existing.interpretation
      };
      const updated = makeRecord(candidate, { id: existing.id, createdAt: existing.createdAt });
      await storage.put(updated);
      return clone(updated);
    },

    async duplicate(id, options = {}) {
      const existing = await storage.get(id);
      if (!existing) throw new WorkoutRepositoryError("NOT_FOUND", "No se ha encontrado el WOD que quieres duplicar.");
      return this.create({
        schemaVersion: existing.schemaVersion,
        title: options.title || `${existing.title} (copia)`,
        sourceText: existing.sourceText,
        workout: existing.workout,
        timer: existing.timer,
        interpretation: existing.interpretation
      });
    },

    async delete(id) {
      const existing = await storage.get(id);
      if (!existing) return null;
      await storage.delete(id);
      return clone(existing);
    },

    async restore(record) {
      if (!record || typeof record.id !== "string" || !record.id) {
        throw new WorkoutRepositoryError("INVALID_RECORD", "No se puede restaurar un registro sin identificador.");
      }
      if (await storage.get(record.id)) {
        throw new WorkoutRepositoryError("ALREADY_EXISTS", "El WOD ya existe y no se ha sobrescrito.");
      }
      const restored = makeRecord(record, { id: record.id, createdAt: record.createdAt });
      await storage.put(restored);
      return clone(restored);
    }
  };
}
