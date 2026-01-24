/**
 * Firebase 配置和初始化
 */
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, TwitterAuthProvider } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyCE2szjilAFApenuJCE1E0UJyb8GVmP0u8",
  authDomain: "shrine-map-78d5f.firebaseapp.com",
  projectId: "shrine-map-78d5f",
  storageBucket: "shrine-map-78d5f.firebasestorage.app",
  messagingSenderId: "249803646799",
  appId: "1:249803646799:web:01688ba044b928ad07073a",
  measurementId: "G-SQ0BFCRQDK"
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
