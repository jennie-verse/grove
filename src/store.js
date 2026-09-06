import { DB_VERSION } from "./model.js";

const DB_NAME = "grove-db";
let database = null;

export async function openDB() {
  if (database) return database;
  database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("maps")) db.createObjectStore("maps", { keyPath: "id" });
      if (!db.objectStoreNames.contains("views")) db.createObjectStore("views", { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); database = null; };
      resolve(db);
    };
    request.onerror = () => reject(storageError(request.error, "OPEN_FAILED"));
    request.onblocked = () => reject(Object.assign(
      new Error("Database upgrade is blocked by another Grove window."),
      { code: "UPGRADE_BLOCKED" },
    ));
  });
  return database;
}

export async function listRecords() {
  return requestFromStore("maps", "readonly", (store) => store.getAll());
}

export async function getRecord(id) {
  return requestFromStore("maps", "readonly", (store) => store.get(id), null);
}

export async function putRecord(record, expectedRevision = null) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("maps", "readwrite");
    const store = transaction.objectStore("maps");
    const read = store.get(record.id);
    let result;
    let settled = false;

    read.onsuccess = () => {
      const current = read.result || null;
      if (expectedRevision !== null && (current?.revision ?? 0) !== expectedRevision) {
        settled = true;
        transaction.abort();
        reject(Object.assign(new Error("This map changed in another Grove window."), {
          code: "REVISION_CONFLICT",
          current,
        }));
        return;
      }
      result = {
        id: record.id,
        revision: current ? (current.revision ?? 0) + 1 : 0,
        map: record.map,
        thumbnail: record.thumbnail ?? current?.thumbnail ?? null,
      };
      store.put(result);
    };
    read.onerror = () => {
      settled = true;
      reject(storageError(read.error, "READ_FAILED"));
    };
    transaction.oncomplete = () => { if (!settled) resolve(result); };
    transaction.onerror = () => { if (!settled) reject(storageError(transaction.error, "SAVE_FAILED")); };
    transaction.onabort = () => {
      if (!settled) reject(storageError(transaction.error, "SAVE_ABORTED"));
    };
  });
}

export async function deleteRecord(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["maps", "views"], "readwrite");
    transaction.objectStore("maps").delete(id);
    transaction.objectStore("views").delete(id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(storageError(transaction.error, "DELETE_FAILED"));
    transaction.onabort = () => reject(storageError(transaction.error, "DELETE_ABORTED"));
  });
}

export async function putMany(records) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("maps", "readwrite");
    const store = transaction.objectStore("maps");
    const read = store.getAll();
    read.onsuccess = () => {
      const currentById = new Map(read.result.map((record) => [record.id, record]));
      for (const record of records) {
        const current = currentById.get(record.id);
        store.put({
          id: record.id,
          revision: current ? (current.revision ?? 0) + 1 : 0,
          map: record.map,
          thumbnail: record.thumbnail ?? current?.thumbnail ?? null,
        });
      }
    };
    read.onerror = () => reject(storageError(read.error, "IMPORT_READ_FAILED"));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(storageError(transaction.error, "IMPORT_FAILED"));
    transaction.onabort = () => reject(storageError(transaction.error, "IMPORT_ABORTED"));
  });
}

export async function replaceAll(records) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["maps", "views"], "readwrite");
    const maps = transaction.objectStore("maps");
    const views = transaction.objectStore("views");
    const read = maps.getAll();
    read.onsuccess = () => {
      const currentById = new Map(read.result.map((record) => [record.id, record]));
      maps.clear();
      views.clear();
      for (const record of records) {
        const current = currentById.get(record.id);
        maps.put({
          id: record.id,
          revision: current ? (current.revision ?? 0) + 1 : 0,
          map: record.map,
          thumbnail: null,
        });
      }
    };
    read.onerror = () => reject(storageError(read.error, "RESTORE_READ_FAILED"));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(storageError(transaction.error, "RESTORE_FAILED"));
    transaction.onabort = () => reject(storageError(transaction.error, "RESTORE_ABORTED"));
  });
}

export async function getView(id) {
  return requestFromStore("views", "readonly", (store) => store.get(id), null);
}

export async function putView(view) {
  return requestFromStore("views", "readwrite", (store) => store.put(view));
}

export async function clearAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["maps", "views", "meta"], "readwrite");
    transaction.objectStore("maps").clear();
    transaction.objectStore("views").clear();
    transaction.objectStore("meta").clear();
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(storageError(transaction.error, "RESET_FAILED"));
    transaction.onabort = () => reject(storageError(transaction.error, "RESET_ABORTED"));
  });
}

export async function storageEstimate() {
  return navigator.storage?.estimate ? navigator.storage.estimate() : null;
}

export async function persistentStorageStatus() {
  if (!navigator.storage?.persisted) return "Not supported";
  try { return await navigator.storage.persisted() ? "Granted" : "Not granted"; }
  catch { return "Unavailable"; }
}

async function requestFromStore(storeName, mode, createRequest, fallback = undefined) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = createRequest(transaction.objectStore(storeName));
    let result = fallback;
    let settled = false;
    request.onsuccess = () => {
      result = request.result ?? fallback;
      if (mode === "readonly") {
        settled = true;
        resolve(result);
      }
    };
    request.onerror = () => {
      settled = true;
      reject(storageError(request.error, "REQUEST_FAILED"));
    };
    if (mode !== "readonly") {
      transaction.oncomplete = () => { if (!settled) resolve(result); };
    }
    transaction.onerror = () => { if (!settled) reject(storageError(transaction.error, "TRANSACTION_FAILED")); };
    transaction.onabort = () => { if (!settled) reject(storageError(transaction.error, "TRANSACTION_ABORTED")); };
  });
}

function storageError(error, code) {
  if (error?.name === "QuotaExceededError") {
    return Object.assign(new Error("Grove is out of local storage space."), { code: "QUOTA_EXCEEDED", cause: error });
  }
  return Object.assign(new Error(error?.message || "Local storage failed."), { code, cause: error });
}
