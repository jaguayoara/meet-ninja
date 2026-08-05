/**
 * Wrapper minimal de IndexedDB para guardar los Blobs de audio de las
 * sesiones. Solo guardamos el Blob (y un mime de regalo); el resto de
 * los datos de la sesion siguen en localStorage.
 *
 * Por que IDB y no localStorage?
 *  - localStorage tiene un limite de ~5MB en la mayoria de los browsers
 *  - IDB aguanta gigas y es async (no bloquea el main thread)
 */
const DB_NAME = 'meetninja';
const DB_VERSION = 1;
const STORE_NAME = 'session-audio';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no disponible'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txStore(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

function reqAsPromise<T>(req: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

export type StoredAudio = {
  blob: Blob;
  mime: string;
};

export async function saveAudio(sessionId: string, blob: Blob): Promise<void> {
  const db = await openDB();
  const store = txStore(db, 'readwrite');
  await reqAsPromise<IDBValidKey>(store.put({ blob, mime: blob.type }, sessionId));
  db.close();
}

export async function loadAudio(sessionId: string): Promise<StoredAudio | null> {
  try {
    const db = await openDB();
    const store = txStore(db, 'readonly');
    const result = await reqAsPromise<{ blob: Blob; mime: string } | undefined>(store.get(sessionId));
    db.close();
    return result ? { blob: result.blob, mime: result.mime } : null;
  } catch {
    return null;
  }
}

export async function deleteAudio(sessionId: string): Promise<void> {
  try {
    const db = await openDB();
    const store = txStore(db, 'readwrite');
    await reqAsPromise<undefined>(store.delete(sessionId));
    db.close();
  } catch {
    // ignore
  }
}

export async function listAudioIds(): Promise<string[]> {
  try {
    const db = await openDB();
    const store = txStore(db, 'readonly');
    const result = await reqAsPromise<IDBValidKey[]>(store.getAllKeys());
    db.close();
    return (result as string[]) || [];
  } catch {
    return [];
  }
}
