/**
 * Firebase 配置和初始化
 */
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, TwitterAuthProvider } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "***REMOVED***",
  authDomain: "***REMOVED***",
  projectId: "***REMOVED***",
  storageBucket: "***REMOVED***.firebasestorage.app",
  messagingSenderId: "***REMOVED***",
  appId: "1:***REMOVED***:web:01688ba044b928ad07073a",
  measurementId: "***REMOVED***"
};

// 初始化 Firebase
const app = initializeApp(firebaseConfig);

// 导出 Auth 实例
export const auth = getAuth(app);

// 导出 Google 登录提供者
export const googleProvider = new GoogleAuthProvider();

// 导出 Twitter/X 登录提供者
export const twitterProvider = new TwitterAuthProvider();

export default app;
