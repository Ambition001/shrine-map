/**
 * Visit Records Service
 * Not logged in: Uses IndexedDB local storage
 * Logged in: Calls Firebase Functions API
 */

import { getAccessToken, isAuthenticated } from './auth';
import {
  initDB,
  getAllVisits,
  addVisitToDB,
  removeVisitFromDB,
  clearAllVisits,
  migrateFromLocalStorage,
  addPendingOperation,
  getPendingOperations,
  removePendingOperation,
  clearPendingOperations
} from './storage';

const STORAGE_KEY = 'visited-shrines'; // Kept for cleaning up old data
const isDev = process.env.NODE_ENV === 'development';
const authEnabled = process.env.REACT_APP_AUTH_ENABLED === 'true';
const API_URL = process.env.REACT_APP_API_URL || '/api';

/**
 * Build API request headers
 */
const buildAuthHeaders = (token) => ({
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json'
});

/**
 * Build fetch options for authenticated requests
 * @param {string} method - HTTP method
 * @param {string|null} token - Access token from Firebase
 */
const buildFetchOptions = (method = 'GET', token = null) => {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json'
    }
  };

  if (token && token !== 'mock-token') {
    options.headers = buildAuthHeaders(token);
  }

  return options;
};

/**
 * Initialize local storage (IndexedDB)
 * Called at app startup, automatically migrates localStorage data
 * @returns {Promise<{migrated: boolean, count: number}>}
 */
export const initLocalStorage = async () => {
  await initDB();
  return await migrateFromLocalStorage();
};

/**
 * Get visit records from local storage
 * @returns {Promise<Set<number>>}
 */
const getFromLocal = async () => {
  try {
    return await getAllVisits();
  } catch {
    return new Set();
  }
};

/**
 * Get all visit records for the user
 * @returns {Promise<Set<number>>}
 */
export const getVisits = async () => {
  const token = await getAccessToken();

  // Not logged in: use IndexedDB
  if (!token || token === 'mock-token') {
    // mock-token indicates dev mode without real auth
    if (token === 'mock-token' && isDev && !authEnabled) {
      return await getFromLocal();
    }
    // Actually not logged in
    if (!token) {
      return await getFromLocal();
    }
  }

  // Logged in: call API
  try {
    const response = await fetch(`${API_URL}/visits`, buildFetchOptions('GET', token));

    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch (e) {
        errorData = { error: 'Unknown API error' };
      }
      throw new Error(`API error: ${response.status}${errorData.message ? ' - ' + errorData.message : ''}`);
    }

    const data = await response.json();
    return new Set(data.map(v => v.shrineId));
  } catch {
    // Fallback to local storage
    return await getFromLocal();
  }
};

/**
 * Add a visit record
 * @param {number} shrineId
 * @returns {Promise<Set<number>>}
 */
export const addVisit = async (shrineId) => {
  const token = await getAccessToken();

  // Not logged in: save to IndexedDB
  if (!token) {
    await addVisitToDB(shrineId);
    return await getFromLocal();
  }

  // Dev mode mock token also uses local storage
  if (token === 'mock-token' && isDev && !authEnabled) {
    await addVisitToDB(shrineId);
    return await getFromLocal();
  }

  // Logged in: call API
  try {
    const response = await fetch(`${API_URL}/visits/${shrineId}`, buildFetchOptions('POST', token));

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return await getVisits();
  } catch {
    // Fallback to local storage
    await addVisitToDB(shrineId);
    return await getFromLocal();
  }
};

/**
 * Remove a visit record
 * @param {number} shrineId
 * @returns {Promise<Set<number>>}
 */
export const removeVisit = async (shrineId) => {
  const token = await getAccessToken();

  // Not logged in: delete from IndexedDB
  if (!token) {
    await removeVisitFromDB(shrineId);
    return await getFromLocal();
  }

  // Dev mode mock token also uses local storage
  if (token === 'mock-token' && isDev && !authEnabled) {
    await removeVisitFromDB(shrineId);
    return await getFromLocal();
  }

  // Logged in: call API
  try {
    const response = await fetch(`${API_URL}/visits/${shrineId}`, buildFetchOptions('DELETE', token));

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return await getVisits();
  } catch {
    // Fallback to local storage
    await removeVisitFromDB(shrineId);
    return await getFromLocal();
  }
};

/**
 * Toggle visit status
 * @param {number} shrineId
 * @param {Set<number>} currentVisits
 * @returns {Promise<Set<number>>}
 */
export const toggleVisit = async (shrineId, currentVisits) => {
  if (currentVisits.has(shrineId)) {
    return removeVisit(shrineId);
  } else {
    return addVisit(shrineId);
  }
};

/**
 * Merge local data to cloud
 * Called after login to sync local records to DB
 * @returns {Promise<{merged: boolean, count: number}>}
 */
export const mergeLocalToCloud = async () => {
  const token = await getAccessToken();
  if (!token || token === 'mock-token') {
    return { merged: false, count: 0 };
  }

  const localVisits = await getFromLocal();
  if (localVisits.size === 0) {
    return { merged: false, count: 0 };
  }

  // Batch upload local records to cloud
  const promises = [...localVisits].map(shrineId =>
    fetch(`${API_URL}/visits/${shrineId}`, buildFetchOptions('POST', token))
  );

  try {
    await Promise.all(promises);
    // Clear local storage
    await clearAllVisits();
    localStorage.removeItem(STORAGE_KEY); // Ensure old localStorage is cleared
    return { merged: true, count: localVisits.size };
  } catch {
    return { merged: false, count: 0 };
  }
};

/**
 * Get count of locally stored visit records
 * Used for UI display
 * @returns {Promise<number>}
 */
export const getLocalVisitsCount = async () => {
  const visits = await getFromLocal();
  return visits.size;
};

/**
 * Clear local storage (including visits table and pending queue)
 * @returns {Promise<void>}
 */
export const clearLocalStorage = async () => {
  await clearAllVisits();
  await clearPendingOperations(); // Also clear pending sync queue
  localStorage.removeItem(STORAGE_KEY);
};

/**
 * Smart merge: Decide whether to ask user based on conflict situation
 * 90% of cases are handled automatically, only true conflicts need user decision
 *
 * @returns {Promise<{
 *   action: 'skip' | 'use_cloud' | 'uploaded_local' | 'ask_user',
 *   reason: string,
 *   count?: number,
 *   conflict?: {
 *     localVisits: Set<number>,
 *     cloudVisits: Set<number>,
 *     onlyLocal: number[],
 *     onlyCloud: number[],
 *     common: number[]
 *   }
 * }>}
 */
export const smartMerge = async () => {
  const token = await getAccessToken();
  if (!token || token === 'mock-token') {
    return { action: 'skip', reason: 'not_logged_in' };
  }

  // First check if there are pending operations (offline operations)
  // If so, sync them first before checking for conflicts
  const pendingOps = await getPendingOperations();
  if (pendingOps.length > 0) {
    const syncResult = await doSync(token);

    // After sync, if all succeeded, use cloud data
    // Note: Don't clear local visits table, keep as cache
    if (syncResult.failed === 0) {
      return { action: 'use_cloud', reason: 'pending_synced', count: syncResult.synced };
    }
    // If some failed, continue to conflict detection logic below
  }

  const localVisits = await getFromLocal();

  // Case 1: Local is empty → use cloud directly
  if (localVisits.size === 0) {
    return { action: 'use_cloud', reason: 'local_empty' };
  }

  // Get cloud data
  let cloudVisits;
  try {
    const response = await fetch(`${API_URL}/visits`, buildFetchOptions('GET', token));

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    cloudVisits = new Set(data.map(v => v.shrineId));
  } catch {
    return { action: 'use_local', reason: 'cloud_error' };
  }

  // Case 2: Cloud is empty → upload local directly
  if (cloudVisits.size === 0) {
    const result = await mergeLocalToCloud();
    return { action: 'uploaded_local', reason: 'cloud_empty', count: result.count };
  }

  // Case 3: Identical → use cloud (clear local)
  const localArray = [...localVisits].sort((a, b) => a - b);
  const cloudArray = [...cloudVisits].sort((a, b) => a - b);
  if (JSON.stringify(localArray) === JSON.stringify(cloudArray)) {
    await clearLocalStorage();
    return { action: 'use_cloud', reason: 'identical' };
  }

  // Case 4: Local is subset of cloud → use cloud
  const isLocalSubset = [...localVisits].every(id => cloudVisits.has(id));
  if (isLocalSubset) {
    await clearLocalStorage();
    return { action: 'use_cloud', reason: 'local_subset' };
  }

  // Case 5: Cloud is subset of local → upload local
  const isCloudSubset = [...cloudVisits].every(id => localVisits.has(id));
  if (isCloudSubset) {
    const result = await mergeLocalToCloud();
    return { action: 'uploaded_local', reason: 'cloud_subset', count: result.count };
  }

  // Case 6: True conflict → need to ask user
  const onlyLocal = [...localVisits].filter(id => !cloudVisits.has(id));
  const onlyCloud = [...cloudVisits].filter(id => !localVisits.has(id));
  const common = [...localVisits].filter(id => cloudVisits.has(id));

  return {
    action: 'ask_user',
    reason: 'conflict',
    conflict: {
      localVisits,
      cloudVisits,
      onlyLocal,
      onlyCloud,
      common
    }
  };
};

/**
 * Replace cloud data with local data
 * Delete cloud-only records, upload local data
 * @param {number[]} onlyCloudIds - List of shrineIds only in cloud (to be deleted)
 * @returns {Promise<{replaced: boolean, uploaded: number, deleted: number, finalVisits: Set<number>}>}
 */
export const replaceCloudWithLocal = async (onlyCloudIds = []) => {
  const token = await getAccessToken();
  if (!token || token === 'mock-token') {
    return { replaced: false, uploaded: 0, deleted: 0, finalVisits: new Set() };
  }

  const localVisits = await getFromLocal();

  // 1. Delete cloud-only records
  if (onlyCloudIds.length > 0) {
    const deletePromises = onlyCloudIds.map(shrineId =>
      fetch(`${API_URL}/visits/${shrineId}`, buildFetchOptions('DELETE', token))
    );

    try {
      await Promise.all(deletePromises);
    } catch {
      return { replaced: false, uploaded: 0, deleted: 0, finalVisits: new Set() };
    }
  }

  // 2. Upload all local records (cloud will auto-dedupe)
  if (localVisits.size > 0) {
    const uploadPromises = [...localVisits].map(shrineId =>
      fetch(`${API_URL}/visits/${shrineId}`, buildFetchOptions('POST', token))
    );

    try {
      await Promise.all(uploadPromises);
    } catch {
      return { replaced: false, uploaded: 0, deleted: onlyCloudIds.length, finalVisits: new Set() };
    }
  }

  // 3. Clear local storage
  await clearLocalStorage();

  // 4. Return local data as final result (avoid Cosmos DB consistency delay)
  return {
    replaced: true,
    uploaded: localVisits.size,
    deleted: onlyCloudIds.length,
    finalVisits: localVisits
  };
};

/**
 * Merge all data (local + cloud)
 * Used when user chooses "merge all" during conflict
 * @returns {Promise<{merged: boolean, count: number, finalVisits: Set<number>}>}
 */
export const mergeAll = async () => {
  const token = await getAccessToken();
  if (!token || token === 'mock-token') {
    return { merged: false, count: 0, finalVisits: new Set() };
  }

  const localVisits = await getFromLocal();

  // Get cloud data
  let cloudVisits;
  try {
    const response = await fetch(`${API_URL}/visits`, buildFetchOptions('GET', token));
    const data = await response.json();
    cloudVisits = new Set(data.map(v => v.shrineId));
  } catch {
    return { merged: false, count: 0, finalVisits: new Set() };
  }

  // Calculate merged set (local + cloud)
  const mergedVisits = new Set([...localVisits, ...cloudVisits]);

  // When local is empty, return cloud data directly
  if (localVisits.size === 0) {
    return { merged: true, count: 0, finalVisits: mergedVisits };
  }

  // Only upload items in local but not in cloud
  const onlyLocal = [...localVisits].filter(id => !cloudVisits.has(id));

  if (onlyLocal.length === 0) {
    await clearLocalStorage();
    return { merged: true, count: 0, finalVisits: mergedVisits };
  }

  // Upload local-only records
  const results = await Promise.all(
    onlyLocal.map(async (shrineId) => {
      try {
        const response = await fetch(`${API_URL}/visits/${shrineId}`, buildFetchOptions('POST', token));
        return { shrineId, success: response.ok };
      } catch {
        return { shrineId, success: false };
      }
    })
  );

  const successCount = results.filter(r => r.success).length;
  const failedCount = results.filter(r => !r.success).length;

  if (failedCount > 0) {
    // Even if partially failed, return merged data (for correct UI), but keep local data for retry
    return { merged: false, count: successCount, finalVisits: mergedVisits };
  }

  await clearLocalStorage();
  return { merged: true, count: onlyLocal.length, finalVisits: mergedVisits };
};

// ============================================
// Local-First + Background Sync (Offline-First)
// ============================================

// Sync lock to prevent concurrent syncing
let isSyncing = false;

/**
 * Smart add pending operation (dedup/merge)
 * Avoid redundant operations from rapid toggling, e.g. [add 101, remove 101, add 101]
 * @param {'add' | 'remove'} action - Operation type
 * @param {number} shrineId - Shrine ID
 */
const addPendingOperationSmart = async (action, shrineId) => {
  const pendingOps = await getPendingOperations();

  // Find existing operations for the same shrineId
  const existingOps = pendingOps.filter(op => op.shrineId === shrineId);

  if (existingOps.length > 0) {
    // Get the last operation
    const lastOp = existingOps[existingOps.length - 1];

    // If last operation is same as current, skip (already in queue)
    if (lastOp.action === action) {
      return;
    }

    // If last operation is opposite of current, delete all operations for this shrineId (they cancel out)
    // e.g.: queue has add 101, now want remove 101 → delete both
    for (const op of existingOps) {
      await removePendingOperation(op.id);
    }
    return;
  }

  // No existing operation, add normally
  await addPendingOperation(action, shrineId);
};

/**
 * Execute sync of pending operations (core logic)
 * @param {string|null} token - Access token for API calls
 * @returns {Promise<{synced: number, failed: number}>}
 */
const doSync = async (token = null) => {
  const pendingOps = await getPendingOperations();
  if (pendingOps.length === 0) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;

  for (const op of pendingOps) {
    try {
      const response = await fetch(`${API_URL}/visits/${op.shrineId}`,
        buildFetchOptions(op.action === 'add' ? 'POST' : 'DELETE', token)
      );

      if (response.ok || response.status === 404) {
        // Success, or record doesn't exist (on delete), remove from queue
        await removePendingOperation(op.id);
        synced++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  return { synced, failed };
};

/**
 * Background sync pending operations to cloud
 * Non-blocking, runs asynchronously
 */
export const syncPendingOperations = async () => {
  if (isSyncing) return;

  // Don't try to sync when offline
  if (!navigator.onLine) {
    return;
  }

  isSyncing = true;

  try {
    const token = await getAccessToken();
    if (!token || token === 'mock-token') {
      return;
    }

    await doSync(token);
  } finally {
    isSyncing = false;
  }
};

/**
 * Add visit record (local-first)
 * Immediately write to local IndexedDB, then sync to cloud in background
 * @param {number} shrineId
 * @returns {Promise<Set<number>>}
 */
export const addVisitOptimistic = async (shrineId) => {
  // 1. Immediately write to local IndexedDB
  await addVisitToDB(shrineId);

  // 2. Check if cloud sync is needed
  // Dev mode without auth enabled doesn't need sync
  if (isDev && !authEnabled) {
    return await getFromLocal();
  }

  // 3. Check if user is logged in (using local cached state, works offline too)
  if (!isAuthenticated()) {
    // Not logged in, only use local storage
    return await getFromLocal();
  }

  // 4. Logged in user: add to pending sync queue (smart dedup)
  await addPendingOperationSmart('add', shrineId);

  // 5. Trigger background sync (non-blocking, will fail offline but queue preserved)
  syncPendingOperations();

  // 6. Immediately return local data
  return await getFromLocal();
};

/**
 * Remove visit record (local-first)
 * @param {number} shrineId
 * @returns {Promise<Set<number>>}
 */
export const removeVisitOptimistic = async (shrineId) => {
  // 1. Immediately delete from local
  await removeVisitFromDB(shrineId);

  // 2. Check if cloud sync is needed
  if (isDev && !authEnabled) {
    return await getFromLocal();
  }

  // 3. Check if user is logged in
  if (!isAuthenticated()) {
    return await getFromLocal();
  }

  // 4. Logged in user: add to pending sync queue (smart dedup)
  await addPendingOperationSmart('remove', shrineId);

  // 5. Trigger background sync
  syncPendingOperations();

  // 6. Return local data
  return await getFromLocal();
};

/**
 * Toggle visit status (local-first version)
 * @param {number} shrineId
 * @param {Set<number>} currentVisits
 * @returns {Promise<Set<number>>}
 */
export const toggleVisitOptimistic = async (shrineId, currentVisits) => {
  if (currentVisits.has(shrineId)) {
    return removeVisitOptimistic(shrineId);
  } else {
    return addVisitOptimistic(shrineId);
  }
};

/**
 * Get count of pending sync operations
 * @returns {Promise<number>}
 */
export const getPendingCount = async () => {
  const ops = await getPendingOperations();
  return ops.length;
};

/**
 * Clear pending sync queue (used on login/logout)
 */
export const clearPendingQueue = async () => {
  await clearPendingOperations();
};
