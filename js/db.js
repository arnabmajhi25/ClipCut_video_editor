// Tiny IndexedDB wrapper: persists imported media blobs and the project JSON
// so your work survives reloads (and the Spotify login redirect).
const DB_NAME = 'clipforge';
const DB_VERSION = 1;
let dbPromise;

function open() {
  return (dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

async function run(storeName, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const putMedia = (m) =>
  run('media', 'readwrite', (s) =>
    s.put({ id: m.id, name: m.name, type: m.type, blob: m.blob, duration: m.duration, width: m.width, height: m.height, source: m.source || null })
  );
export const allMedia = () => run('media', 'readonly', (s) => s.getAll());
export const deleteMedia = (id) => run('media', 'readwrite', (s) => s.delete(id));
export const clearMedia = () => run('media', 'readwrite', (s) => s.clear());
export const setKV = (key, value) => run('kv', 'readwrite', (s) => s.put(value, key));
export const getKV = (key) => run('kv', 'readonly', (s) => s.get(key));
