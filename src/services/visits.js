/**
 * 参拜记录服务
 * 未登录: 使用 IndexedDB 本地存储
 * 已登录: 调用 Azure Functions API
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

const STORAGE_KEY = 'visited-shrines'; // 保留用于清理旧数据
const isDev = process.env.NODE_ENV === 'development';
const authEnabled = process.env.REACT_APP_AUTH_ENABLED === 'true';
const API_URL = process.env.REACT_APP_API_URL || '/api';

/**
 * 初始化本地存储（IndexedDB）
 * 应用启动时调用，自动迁移 localStorage 数据
 * @returns {Promise<{migrated: boolean, count: number}>}
 */
export const initLocalStorage = async () => {
  await initDB();
  return await migrateFromLocalStorage();
};

/**
 * 从本地存储获取参拜记录
 * @returns {Promise<Set<number>>}
 */
const getFromLocal = async () => {
  try {
    return await getAllVisits();
  } catch (error) {
    console.error('读取 IndexedDB 失败:', error);
    return new Set();
  }
};

/**
 * 获取用户所有参拜记录
 * @returns {Promise<Set<number>>}
 */
export const getVisits = async () => {
  const token = await getAccessToken();

  // 未登录：使用 IndexedDB
  if (!token || token === 'mock-token') {
    // mock-token 表示开发模式未启用真实认证
    if (token === 'mock-token' && isDev && !authEnabled) {
      return await getFromLocal();
    }
    // 真正未登录的情况
    if (!token) {
      return await getFromLocal();
    }
  }

  // 已登录：调用 API
  try {
    const response = await fetch(`${API_URL}/visits`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`API 错误: ${response.status}`);
    }

    const data = await response.json();
    return new Set(data.map(v => v.shrineId));
  } catch (error) {
    console.error('获取参拜记录失败:', error);
    // 降级到本地存储
    return await getFromLocal();
  }
};

/**
 * 添加参拜记录
 * @param {number} shrineId
 * @returns {Promise<Set<number>>}
 */
export const addVisit = async (shrineId) => {
  const token = await getAccessToken();

  // 未登录：保存到 IndexedDB
  if (!token) {
    await addVisitToDB(shrineId);
    return await getFromLocal();
  }

  // 开发模式 mock token 也用本地存储
  if (token === 'mock-token' && isDev && !authEnabled) {
    await addVisitToDB(shrineId);
    return await getFromLocal();
  }

  // 已登录：调用 API
  try {
    const response = await fetch(`${API_URL}/visits/${shrineId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`API 错误: ${response.status}`);
    }

    return await getVisits();
  } catch (error) {
    console.error('添加参拜记录失败:', error);
    // 降级到本地存储
    await addVisitToDB(shrineId);
    return await getFromLocal();
  }
};

/**
 * 删除参拜记录
 * @param {number} shrineId
 * @returns {Promise<Set<number>>}
 */
export const removeVisit = async (shrineId) => {
  const token = await getAccessToken();

  // 未登录：从 IndexedDB 删除
  if (!token) {
    await removeVisitFromDB(shrineId);
    return await getFromLocal();
  }

  // 开发模式 mock token 也用本地存储
  if (token === 'mock-token' && isDev && !authEnabled) {
    await removeVisitFromDB(shrineId);
    return await getFromLocal();
  }

  // 已登录：调用 API
  try {
    const response = await fetch(`${API_URL}/visits/${shrineId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`API 错误: ${response.status}`);
    }

    return await getVisits();
  } catch (error) {
    console.error('删除参拜记录失败:', error);
    // 降级到本地存储
    await removeVisitFromDB(shrineId);
    return await getFromLocal();
  }
};

/**
 * 切换参拜状态
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
 * 合并本地数据到云端
 * 登录后调用，将本地记录同步到 DB
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

  // 批量上传本地记录到云端
  const promises = [...localVisits].map(shrineId =>
    fetch(`${API_URL}/visits/${shrineId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    })
  );

  try {
    await Promise.all(promises);
    // 清空本地存储
    await clearAllVisits();
    localStorage.removeItem(STORAGE_KEY); // 确保清除旧的 localStorage
    return { merged: true, count: localVisits.size };
  } catch (error) {
    console.error('合并数据失败:', error);
    return { merged: false, count: 0 };
  }
};

/**
 * 获取本地存储的参拜记录数量
 * 用于 UI 显示
 * @returns {Promise<number>}
 */
export const getLocalVisitsCount = async () => {
  const visits = await getFromLocal();
  return visits.size;
};

/**
 * 清空本地存储（包括 visits 表和 pending 队列）
 * @returns {Promise<void>}
 */
export const clearLocalStorage = async () => {
  await clearAllVisits();
  await clearPendingOperations(); // 同时清空待同步队列
  localStorage.removeItem(STORAGE_KEY);
};

/**
 * 智能合并：根据冲突情况决定是否询问用户
 * 90% 的情况自动处理，只在真正有冲突时才需要用户决策
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

  // 先检查是否有待同步的操作（离线时的操作）
  // 如果有，先同步完成后再判断冲突
  const pendingOps = await getPendingOperations();
  if (pendingOps.length > 0) {
    const syncResult = await doSync(token);

    // 同步完成后，如果全部成功，直接使用云端数据
    // 注意：不清空本地 visits 表，保留作为缓存
    if (syncResult.failed === 0) {
      return { action: 'use_cloud', reason: 'pending_synced', count: syncResult.synced };
    }
    // 如果有失败的，继续下面的冲突检测逻辑
  }

  const localVisits = await getFromLocal();

  // 情况 1：本地为空 → 直接用云端
  if (localVisits.size === 0) {
    return { action: 'use_cloud', reason: 'local_empty' };
  }

  // 获取云端数据
  let cloudVisits;
  try {
    const response = await fetch(`${API_URL}/visits`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`API 错误: ${response.status}`);
    }

    const data = await response.json();
    cloudVisits = new Set(data.map(v => v.shrineId));
  } catch (error) {
    console.error('获取云端数据失败:', error);
    return { action: 'use_local', reason: 'cloud_error' };
  }

  // 情况 2：云端为空 → 直接上传本地
  if (cloudVisits.size === 0) {
    const result = await mergeLocalToCloud();
    return { action: 'uploaded_local', reason: 'cloud_empty', count: result.count };
  }

  // 情况 3：完全相同 → 用云端（清空本地）
  const localArray = [...localVisits].sort((a, b) => a - b);
  const cloudArray = [...cloudVisits].sort((a, b) => a - b);
  if (JSON.stringify(localArray) === JSON.stringify(cloudArray)) {
    await clearLocalStorage();
    return { action: 'use_cloud', reason: 'identical' };
  }

  // 情况 4：本地是云端的子集 → 用云端
  const isLocalSubset = [...localVisits].every(id => cloudVisits.has(id));
  if (isLocalSubset) {
    await clearLocalStorage();
    return { action: 'use_cloud', reason: 'local_subset' };
  }

  // 情况 5：云端是本地的子集 → 上传本地
  const isCloudSubset = [...cloudVisits].every(id => localVisits.has(id));
  if (isCloudSubset) {
    const result = await mergeLocalToCloud();
    return { action: 'uploaded_local', reason: 'cloud_subset', count: result.count };
  }

  // 情况 6：有真正的冲突 → 需要询问用户
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
 * 用本地数据完全覆盖云端
 * 删除云端独有的记录，上传本地数据
 * @param {number[]} onlyCloudIds - 云端独有的 shrineId 列表（需要删除）
 * @returns {Promise<{replaced: boolean, uploaded: number, deleted: number, finalVisits: Set<number>}>}
 */
export const replaceCloudWithLocal = async (onlyCloudIds = []) => {
  const token = await getAccessToken();
  if (!token || token === 'mock-token') {
    return { replaced: false, uploaded: 0, deleted: 0, finalVisits: new Set() };
  }

  const localVisits = await getFromLocal();

  // 1. 删除云端独有的记录
  if (onlyCloudIds.length > 0) {
    const deletePromises = onlyCloudIds.map(shrineId =>
      fetch(`${API_URL}/visits/${shrineId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })
    );

    try {
      await Promise.all(deletePromises);
    } catch (error) {
      console.error('删除云端记录失败:', error);
      return { replaced: false, uploaded: 0, deleted: 0, finalVisits: new Set() };
    }
  }

  // 2. 上传本地所有记录（云端会自动去重）
  if (localVisits.size > 0) {
    const uploadPromises = [...localVisits].map(shrineId =>
      fetch(`${API_URL}/visits/${shrineId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })
    );

    try {
      await Promise.all(uploadPromises);
    } catch (error) {
      console.error('上传本地记录失败:', error);
      return { replaced: false, uploaded: 0, deleted: onlyCloudIds.length, finalVisits: new Set() };
    }
  }

  // 3. 清空本地存储
  await clearLocalStorage();

  // 4. 直接返回本地数据作为最终结果（避免 Cosmos DB 一致性延迟问题）
  return {
    replaced: true,
    uploaded: localVisits.size,
    deleted: onlyCloudIds.length,
    finalVisits: localVisits
  };
};

/**
 * 合并所有数据（本地 + 云端）
 * 用于冲突时用户选择"全部合并"
 * @returns {Promise<{merged: boolean, count: number}>}
 */
export const mergeAll = async () => {
  const token = await getAccessToken();
  if (!token || token === 'mock-token') {
    return { merged: false, count: 0 };
  }

  const localVisits = await getFromLocal();
  if (localVisits.size === 0) {
    return { merged: false, count: 0 };
  }

  // 获取云端数据
  let cloudVisits;
  try {
    const response = await fetch(`${API_URL}/visits`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    const data = await response.json();
    cloudVisits = new Set(data.map(v => v.shrineId));
  } catch (error) {
    console.error('获取云端数据失败:', error);
    return { merged: false, count: 0 };
  }

  // 只上传本地有但云端没有的
  const onlyLocal = [...localVisits].filter(id => !cloudVisits.has(id));

  if (onlyLocal.length === 0) {
    await clearLocalStorage();
    return { merged: true, count: 0 };
  }

  // 上传本地独有的记录
  const promises = onlyLocal.map(shrineId =>
    fetch(`${API_URL}/visits/${shrineId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    })
  );

  try {
    await Promise.all(promises);
    await clearLocalStorage();
    return { merged: true, count: onlyLocal.length };
  } catch (error) {
    console.error('合并数据失败:', error);
    return { merged: false, count: 0 };
  }
};

// ============================================
// 本地优先 + 后台同步（Offline-First）
// ============================================

// 同步锁，防止并发同步
let isSyncing = false;

/**
 * 智能添加待同步操作（去重/合并）
 * 避免快速切换时产生冗余操作，如 [add 101, remove 101, add 101]
 * @param {'add' | 'remove'} action - 操作类型
 * @param {number} shrineId - 神社 ID
 */
const addPendingOperationSmart = async (action, shrineId) => {
  const pendingOps = await getPendingOperations();

  // 查找是否有针对同一 shrineId 的待处理操作
  const existingOps = pendingOps.filter(op => op.shrineId === shrineId);

  if (existingOps.length > 0) {
    // 获取最后一个操作
    const lastOp = existingOps[existingOps.length - 1];

    // 如果最后一个操作与当前操作相同，跳过（已经在队列中）
    if (lastOp.action === action) {
      return;
    }

    // 如果最后一个操作与当前操作相反，删除所有该 shrineId 的操作（相互抵消）
    // 例如：队列中有 add 101，现在要 remove 101 → 两个都删除
    for (const op of existingOps) {
      await removePendingOperation(op.id);
    }
    return;
  }

  // 没有现有操作，正常添加
  await addPendingOperation(action, shrineId);
};

/**
 * 执行待处理操作的同步（核心逻辑）
 * @param {string} token - 访问令牌
 * @returns {Promise<{synced: number, failed: number}>}
 */
const doSync = async (token) => {
  const pendingOps = await getPendingOperations();
  if (pendingOps.length === 0) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;

  for (const op of pendingOps) {
    try {
      const response = await fetch(`${API_URL}/visits/${op.shrineId}`, {
        method: op.action === 'add' ? 'POST' : 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok || response.status === 404) {
        // 成功，或记录不存在（删除时），移除队列
        await removePendingOperation(op.id);
        synced++;
      } else {
        failed++;
      }
    } catch (error) {
      console.error('同步操作失败:', op, error);
      failed++;
    }
  }

  return { synced, failed };
};

/**
 * 后台同步待处理操作到云端
 * 不阻塞调用方，异步执行
 */
export const syncPendingOperations = async () => {
  if (isSyncing) return;

  // 离线时不尝试同步
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
 * 添加参拜记录（本地优先）
 * 立即写入本地 IndexedDB，然后后台同步到云端
 * @param {number} shrineId
 * @returns {Promise<Set<number>>}
 */
export const addVisitOptimistic = async (shrineId) => {
  // 1. 立即写入本地 IndexedDB
  await addVisitToDB(shrineId);

  // 2. 检查是否需要同步云端
  // 开发模式且未启用认证时，不需要同步
  if (isDev && !authEnabled) {
    return await getFromLocal();
  }

  // 3. 检查用户是否已登录（使用本地缓存状态，离线时也能正确判断）
  if (!isAuthenticated()) {
    // 未登录，只用本地存储
    return await getFromLocal();
  }

  // 4. 已登录用户：添加到待同步队列（智能去重）
  await addPendingOperationSmart('add', shrineId);

  // 5. 触发后台同步（不阻塞，离线时会失败但队列保留）
  syncPendingOperations();

  // 6. 立即返回本地数据
  return await getFromLocal();
};

/**
 * 删除参拜记录（本地优先）
 * @param {number} shrineId
 * @returns {Promise<Set<number>>}
 */
export const removeVisitOptimistic = async (shrineId) => {
  // 1. 立即从本地删除
  await removeVisitFromDB(shrineId);

  // 2. 检查是否需要同步云端
  if (isDev && !authEnabled) {
    return await getFromLocal();
  }

  // 3. 检查用户是否已登录
  if (!isAuthenticated()) {
    return await getFromLocal();
  }

  // 4. 已登录用户：添加到待同步队列（智能去重）
  await addPendingOperationSmart('remove', shrineId);

  // 5. 触发后台同步
  syncPendingOperations();

  // 6. 返回本地数据
  return await getFromLocal();
};

/**
 * 切换参拜状态（本地优先版本）
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
 * 获取待同步操作数量
 * @returns {Promise<number>}
 */
export const getPendingCount = async () => {
  const ops = await getPendingOperations();
  return ops.length;
};

/**
 * 清空待同步队列（登录/登出时使用）
 */
export const clearPendingQueue = async () => {
  await clearPendingOperations();
};
