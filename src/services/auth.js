/**
 * 认证服务
 * 使用 Firebase Auth + Google/Twitter 登录
 * 使用 signInWithRedirect 以支持移动端和内网访问
 */
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged
} from 'firebase/auth';
import { auth, googleProvider, twitterProvider } from './firebase';

const isDev = process.env.NODE_ENV === 'development';
const authEnabled = process.env.REACT_APP_AUTH_ENABLED === 'true';

// Mock 用户 (开发模式且未启用认证时)
const MOCK_USER = {
  id: 'dev-user-123',
  name: 'Dev User',
  email: 'dev@example.com'
};

// 在模块加载时立即调用 getRedirectResult（只执行一次）
// 这样可以在 React StrictMode 重新挂载组件之前就获取到结果
const redirectResultPromise = (isDev && !authEnabled)
  ? Promise.resolve(null)
  : (async () => {
    console.log('[Auth] Module init: calling getRedirectResult...');
    try {
      const result = await getRedirectResult(auth);
      console.log('[Auth] Module init: getRedirectResult returned:', result ? 'user found' : 'null');
      if (result) {
        console.log('[Auth] Redirect login successful:', result.user.email);
        return {
          id: result.user.uid,
          name: result.user.displayName,
          email: result.user.email,
          photoURL: result.user.photoURL
        };
      }
      return null;
    } catch (error) {
      console.error('[Auth] Redirect result error:', error);
      return null; // 不抛出错误，避免阻塞应用
    }
  })();

/**
 * 获取登录重定向结果
 * 返回模块初始化时已经获取的结果
 */
export const handleRedirectResult = () => {
  console.log('[Auth] handleRedirectResult called, returning cached promise');
  return redirectResultPromise;
};

/**
 * 监听认证状态变化
 * @param {Function} callback - 回调函数，参数为用户对象或 null
 * @returns {Function} 取消监听的函数
 */
export const onAuthChange = (callback) => {
  console.log('[Auth] onAuthChange called, isDev:', isDev, 'authEnabled:', authEnabled);

  if (isDev && !authEnabled) {
    // Mock 模式直接返回 mock 用户
    console.log('[Auth] Using mock user (dev mode, auth disabled)');
    callback(MOCK_USER);
    return () => { };
  }

  console.log('[Auth] Setting up onAuthStateChanged listener...');
  return onAuthStateChanged(auth, (firebaseUser) => {
    console.log('[Auth] onAuthStateChanged fired, user:', firebaseUser ? firebaseUser.email : 'null');
    if (firebaseUser) {
      callback({
        id: firebaseUser.uid,
        name: firebaseUser.displayName,
        email: firebaseUser.email,
        photoURL: firebaseUser.photoURL
      });
    } else {
      callback(null);
    }
  });
};

/**
 * 获取当前登录用户
 * @returns {Object|null} 用户对象或 null
 */
export const getCurrentUser = () => {
  if (isDev && !authEnabled) {
    return MOCK_USER;
  }

  const firebaseUser = auth.currentUser;
  if (firebaseUser) {
    return {
      id: firebaseUser.uid,
      name: firebaseUser.displayName,
      email: firebaseUser.email,
      photoURL: firebaseUser.photoURL
    };
  }
  return null;
};

/**
 * 检查是否已登录
 * @returns {boolean}
 */
export const isAuthenticated = () => {
  if (isDev && !authEnabled) {
    return true;
  }
  return auth.currentUser !== null;
};

// 检测是否为移动端 (更稳健的检测)
const isMobile = () => {
  const ua = navigator.userAgent;
  const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const isSmallScreen = window.innerWidth <= 1024;
  // 检查是否为触屏设备 (很多现代 iPad 虽然 UA 是 Mac，但有触控点)
  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

  const result = isMobileUA || (isSmallScreen && isTouch);
  console.log('[Auth] Device detection - isMobile:', result, 'UA:', ua, 'Width:', window.innerWidth, 'Touch:', isTouch);
  return result;
};

/**
 * Google 登录
 * 移动端使用 redirect，桌面端使用 popup
 */
export const loginWithGoogle = async () => {
  console.log('[Auth] loginWithGoogle called, isMobile:', isMobile());

  if (isDev && !authEnabled) {
    console.log('[Auth] Dev mode, returning mock user');
    return MOCK_USER;
  }

  try {
    if (isMobile()) {
      // 移动端使用 redirect
      console.log('[Auth] Using signInWithRedirect for mobile...');
      await signInWithRedirect(auth, googleProvider);
    } else {
      // 桌面端使用 popup
      console.log('[Auth] Using signInWithPopup for desktop...');
      const result = await signInWithPopup(auth, googleProvider);
      console.log('[Auth] Popup login successful:', result.user.email);
      return {
        id: result.user.uid,
        name: result.user.displayName,
        email: result.user.email,
        photoURL: result.user.photoURL
      };
    }
  } catch (error) {
    console.error('[Auth] Login error:', error);
    throw error;
  }
};

/**
 * Twitter/X 登录
 * 移动端使用 redirect，桌面端使用 popup
 */
export const loginWithTwitter = async () => {
  console.log('[Auth] loginWithTwitter called, isMobile:', isMobile());

  if (isDev && !authEnabled) {
    return MOCK_USER;
  }

  try {
    if (isMobile()) {
      console.log('[Auth] Using signInWithRedirect for mobile...');
      await signInWithRedirect(auth, twitterProvider);
    } else {
      console.log('[Auth] Using signInWithPopup for desktop...');
      const result = await signInWithPopup(auth, twitterProvider);
      console.log('[Auth] Popup login successful:', result.user.email);
      return {
        id: result.user.uid,
        name: result.user.displayName,
        email: result.user.email,
        photoURL: result.user.photoURL
      };
    }
  } catch (error) {
    console.error('[Auth] Login error:', error);
    throw error;
  }
};

/**
 * 登出
 * @returns {Promise<void>}
 */
export const logout = async () => {
  if (isDev && !authEnabled) {
    return;
  }
  await signOut(auth);
};

/**
 * 获取访问令牌 (用于 API 调用)
 * @returns {Promise<string|null>}
 */
export const getAccessToken = async () => {
  if (isDev && !authEnabled) {
    return 'mock-token';
  }

  const user = auth.currentUser;
  if (user) {
    try {
      // 强制刷新 Token 以确保获取的是最新的 Firebase ID Token
      const token = await user.getIdToken(true);

      // 检查 Token 算法 (HS256 是模拟器 Token，生产环境不可用)
      const header = JSON.parse(atob(token.split('.')[0]));
      console.log('[Auth] Token header:', header);
      console.log('[Auth] Token preview:', token.substring(0, 50) + '...');
      if (header.alg === 'HS256') {
        console.error('[Auth] Detected Emulator Token (HS256) in production. Forcing logout and clearing all auth data.');
        await signOut(auth);
        // 清除所有 Firebase 相关的 IndexedDB 数据
        try {
          const databases = await indexedDB.databases();
          for (const db of databases) {
            if (db.name && db.name.includes('firebase')) {
              indexedDB.deleteDatabase(db.name);
              console.log('[Auth] Deleted IndexedDB:', db.name);
            }
          }
        } catch (e) {
          console.warn('[Auth] Could not clear IndexedDB:', e);
        }
        // 强制刷新页面以确保清理生效
        window.location.reload();
        return null;
      }

      console.log('[Auth] Token retrieved. Length:', token.length, 'Segments:', (token.match(/\./g) || []).length + 1);
      return token;
    } catch (error) {
      console.error('[Auth] Failed to get token:', error);
      return null;
    }
  }
  return null;
};
