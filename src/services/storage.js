/**
 * IndexedDB 本地存储服务
 * 替代 localStorage，支持更大容量和更丰富的数据结构
 */

const DB_NAME = 'shrine-map-db';
const DB_VERSION = 2; // 升级版本以添加 pending-operations store
const STORE_NAME = 'visits';
const PENDING_STORE = 'pending-operations'; // 待同步操作队列
const STORAGE_KEY = 'visited-shrines'; // localStorage key for migration

let db = null;

/**
 * 初始化数据库
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

      // 创建 visits 存储
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'shrineId' });
        store.createIndex('visitedAt', 'visitedAt', { unique: false });
      }

      // 创建待同步操作队列（v2 新增）
      if (!database.objectStoreNames.contains(PENDING_STORE)) {
        database.createObjectStore(PENDING_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
  });
};

/**
 * 获取所有参拜记录
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
 * 添加参拜记录
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
 * 删除参拜记录
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
 * 清空所有记录
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
 * 批量添加参拜记录
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
 * 迁移 localStorage 数据到 IndexedDB
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

    console.log(`IndexedDB 迁移完成: ${shrineIds.length} 条记录`);
    return { migrated: true, count: shrineIds.length };
  } catch (error) {
    console.error('迁移 localStorage 数据失败:', error);
    return { migrated: false, count: 0 };
  }
};

/**
 * 检查是否有待迁移的 localStorage 数据
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
// 待同步操作队列（Pending Operations）
// ============================================

/**
 * 添加待同步操作到队列
 * @param {'add' | 'remove'} action - 操作类型
 * @param {number} shrineId - 神社 ID
 * @returns {Promise<number>} 返回操作 ID
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
 * 获取所有待同步操作
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
 * 删除已同步的操作
 * @param {number} id - 操作 ID
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
 * 清空所有待同步操作
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
