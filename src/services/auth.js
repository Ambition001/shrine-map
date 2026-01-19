/**
 * 认证服务
 * 使用 Firebase Auth + Google 登录
 */
import {
  signInWithPopup,
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

/**
 * 监听认证状态变化
 * @param {Function} callback - 回调函数，参数为用户对象或 null
 * @returns {Function} 取消监听的函数
 */
export const onAuthChange = (callback) => {
  if (isDev && !authEnabled) {
    // Mock 模式直接返回 mock 用户
    callback(MOCK_USER);
    return () => {};
  }

  return onAuthStateChanged(auth, (firebaseUser) => {
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

/**
 * Google 登录
 * @returns {Promise<Object>} 用户对象
 */
export const loginWithGoogle = async () => {
  if (isDev && !authEnabled) {
    return MOCK_USER;
  }

  const result = await signInWithPopup(auth, googleProvider);
  return {
    id: result.user.uid,
    name: result.user.displayName,
    email: result.user.email,
    photoURL: result.user.photoURL
  };
};

/**
 * Twitter/X 登录
 * @returns {Promise<Object>} 用户对象
 */
export const loginWithTwitter = async () => {
  if (isDev && !authEnabled) {
    return MOCK_USER;
  }

  const result = await signInWithPopup(auth, twitterProvider);
  return {
    id: result.user.uid,
    name: result.user.displayName,
    email: result.user.email,
    photoURL: result.user.photoURL
  };
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
    return await user.getIdToken();
  }
  return null;
};
