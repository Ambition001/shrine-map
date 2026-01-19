/**
 * 参拜记录服务
 * 开发模式: 使用 localStorage
 * 生产模式: 调用 Azure Functions API (后续实现)
 */

import { getAccessToken } from './auth';

const STORAGE_KEY = 'visited-shrines';
const isDev = process.env.NODE_ENV === 'development';
const authEnabled = process.env.REACT_APP_AUTH_ENABLED === 'true';
const API_URL = process.env.REACT_APP_API_URL || '/api';

/**
 * 从 localStorage 获取参拜记录
 * @returns {Set<number>}
 */
const getFromLocalStorage = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch (error) {
    console.error('读取本地存储失败:', error);
    return new Set();
  }
};

/**
 * 保存参拜记录到 localStorage
 * @param {Set<number>} visits
 */
const saveToLocalStorage = (visits) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...visits]));
  } catch (error) {
    console.error('保存本地存储失败:', error);
  }
};

/**
 * 获取用户所有参拜记录
 * @returns {Promise<Set<number>>}
 */
export const getVisits = async () => {
  const token = await getAccessToken();

  // 未登录：使用 localStorage
  if (!token || token === 'mock-token') {
    // mock-token 表示开发模式未启用真实认证
    if (token === 'mock-token' && isDev && !authEnabled) {
      return getFromLocalStorage();
    }
    // 真正未登录的情况
    if (!token) {
      return getFromLocalStorage();
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
    return getFromLocalStorage();
  }
};

/**
 * 添加参拜记录
 * @param {number} shrineId
 * @returns {Promise<Set<number>>}
 */
export const addVisit = async (shrineId) => {
  const token = await getAccessToken();

  // 未登录：保存到 localStorage
  if (!token) {
    const visits = getFromLocalStorage();
    visits.add(shrineId);
    saveToLocalStorage(visits);
    return visits;
  }

  // 开发模式 mock token 也用 localStorage
  if (token === 'mock-token' && isDev && !authEnabled) {
    const visits = getFromLocalStorage();
    visits.add(shrineId);
    saveToLocalStorage(visits);
    return visits;
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
    const visits = getFromLocalStorage();
    visits.add(shrineId);
    saveToLocalStorage(visits);
    return visits;
  }
};

/**
 * 删除参拜记录
 * @param {number} shrineId
 * @returns {Promise<Set<number>>}
 */
export const removeVisit = async (shrineId) => {
  const token = await getAccessToken();

  // 未登录：从 localStorage 删除
  if (!token) {
    const visits = getFromLocalStorage();
    visits.delete(shrineId);
    saveToLocalStorage(visits);
    return visits;
  }

  // 开发模式 mock token 也用 localStorage
  if (token === 'mock-token' && isDev && !authEnabled) {
    const visits = getFromLocalStorage();
    visits.delete(shrineId);
    saveToLocalStorage(visits);
    return visits;
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
    const visits = getFromLocalStorage();
    visits.delete(shrineId);
    saveToLocalStorage(visits);
    return visits;
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
 * 登录后调用，将 localStorage 中的记录同步到 DB
 * @returns {Promise<{merged: boolean, count: number}>}
 */
export const mergeLocalToCloud = async () => {
  const token = await getAccessToken();
  if (!token || token === 'mock-token') {
    return { merged: false, count: 0 };
  }

  const localVisits = getFromLocalStorage();
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
    localStorage.removeItem(STORAGE_KEY);
    return { merged: true, count: localVisits.size };
  } catch (error) {
    console.error('合并数据失败:', error);
    return { merged: false, count: 0 };
  }
};

/**
 * 获取本地存储的参拜记录数量
 * 用于 UI 显示
 * @returns {number}
 */
export const getLocalVisitsCount = () => {
  return getFromLocalStorage().size;
};
