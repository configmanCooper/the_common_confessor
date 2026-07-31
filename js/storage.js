const DATABASE_NAME = "the-common-confessor";
const DATABASE_VERSION = 1;
const STORE_NAME = "autosaves";
const SLOT_KEYS = ["slot-0", "slot-1", "slot-2"];
let autosaveQueue = Promise.resolve();

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB could not be opened"));
  });
}

function readRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error || new Error("IndexedDB read failed"));
  });
}

async function rotateAutosaves(serialized) {
  const database = await openDatabase();
  try {
    const existing = await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      Promise.all(SLOT_KEYS.map((key) => readRequest(store.get(key)))).then(resolve, reject);
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB autosave read failed"));
    });
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      if (existing[1]) store.put(existing[1], SLOT_KEYS[2]);
      if (existing[0]) store.put(existing[0], SLOT_KEYS[1]);
      store.put(serialized, SLOT_KEYS[0]);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB autosave write failed"));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB autosave write was aborted"));
    });
  } finally {
    database.close();
  }
}

export function queueAutosave(serialized) {
  autosaveQueue = autosaveQueue.catch(() => {}).then(() => rotateAutosaves(serialized));
  return autosaveQueue;
}

export async function readAutosaves() {
  await autosaveQueue.catch(() => {});
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      Promise.all(SLOT_KEYS.map((key) => readRequest(store.get(key)))).then(
        (values) => resolve(values.filter(Boolean)),
        reject
      );
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB autosave recovery failed"));
    });
  } finally {
    database.close();
  }
}
