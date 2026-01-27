/**
 * IndexedDB Local Storage Service
 * Replaces localStorage, supports larger capacity and richer data structures
 */

const DB_NAME = 'shrine-map-db';
const DB_VERSION = 2; // Version upgrade to add pending-operations store
const STORE_NAME = 'visits';
const PENDING_STORE = 'pending-operations'; // Pending sync operations queue
const STORAGE_KEY = 'visited-shrines'; // localStorage key for migration

let db = null;

/**
 * Initialize database
 * @returns {Promise<IDBDatabase>}
 */
export const initDB = () => {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      // Create visits store
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'shrineId' });
        store.createIndex('visitedAt', 'visitedAt', { unique: false });
      }

      // Create pending operations queue (added in v2)
      if (!database.objectStoreNames.contains(PENDING_STORE)) {
        database.createObjectStore(PENDING_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
  });
};

/**
 * Get all visit records
 * @returns {Promise<Set<number>>}
 */
export const getAllVisits = async () => {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const visits = new Set(request.result.map(v => v.shrineId));
      resolve(visits);
    };
    request.onerror = () => reject(request.error);
  });
};

/**
 * Add a visit record
 * @param {number} shrineId
 * @returns {Promise<void>}
 */
export const addVisitToDB = async (shrineId) => {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put({
      shrineId,
      visitedAt: new Date().toISOString()
    });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

/**
 * Remove a visit record
 * @param {number} shrineId
 * @returns {Promise<void>}
 */
export const removeVisitFromDB = async (shrineId) => {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(shrineId);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

/**
 * Clear all records
 * @returns {Promise<void>}
 */
export const clearAllVisits = async () => {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

/**
 * Bulk add visit records
 * @param {number[]} shrineIds
 * @returns {Promise<void>}
 */
export const bulkAddVisits = async (shrineIds) => {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    const timestamp = new Date().toISOString();

    for (const shrineId of shrineIds) {
      store.put({
        shrineId,
        visitedAt: timestamp
      });
    }

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

/**
 * Migrate localStorage data to IndexedDB
 * @returns {Promise<{migrated: boolean, count: number}>}
 */
export const migrateFromLocalStorage = async () => {
  const oldData = localStorage.getItem(STORAGE_KEY);
  if (!oldData) return { migrated: false, count: 0 };

  try {
    const shrineIds = JSON.parse(oldData);
    if (!Array.isArray(shrineIds) || shrineIds.length === 0) {
      return { migrated: false, count: 0 };
    }

    await bulkAddVisits(shrineIds);
    localStorage.removeItem(STORAGE_KEY);
    return { migrated: true, count: shrineIds.length };
  } catch {
    return { migrated: false, count: 0 };
  }
};

/**
 * Check if there is localStorage data to migrate
 * @returns {boolean}
 */
export const hasLocalStorageData = () => {
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) return false;
  try {
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
};

// ============================================
// Pending Operations Queue
// ============================================

/**
 * Add pending operation to queue
 * @param {'add' | 'remove'} action - Operation type
 * @param {number} shrineId - Shrine ID
 * @returns {Promise<number>} Returns operation ID
 */
export const addPendingOperation = async (action, shrineId) => {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([PENDING_STORE], 'readwrite');
    const store = transaction.objectStore(PENDING_STORE);
    const request = store.add({
      action,
      shrineId,
      createdAt: new Date().toISOString()
    });

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

/**
 * Get all pending operations
 * @returns {Promise<Array<{id: number, action: string, shrineId: number, createdAt: string}>>}
 */
export const getPendingOperations = async () => {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([PENDING_STORE], 'readonly');
    const store = transaction.objectStore(PENDING_STORE);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

/**
 * Remove synced operation
 * @param {number} id - Operation ID
 * @returns {Promise<void>}
 */
export const removePendingOperation = async (id) => {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([PENDING_STORE], 'readwrite');
    const store = transaction.objectStore(PENDING_STORE);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

/**
 * Clear all pending operations
 * @returns {Promise<void>}
 */
export const clearPendingOperations = async () => {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([PENDING_STORE], 'readwrite');
    const store = transaction.objectStore(PENDING_STORE);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};
