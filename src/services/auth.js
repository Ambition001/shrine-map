/**
 * Authentication Service
 * Uses Firebase Auth + Google/Twitter login
 * Desktop uses popup, mobile uses redirect
 */
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
  browserLocalPersistence,
  setPersistence
} from 'firebase/auth';
import { auth, googleProvider, twitterProvider } from './firebase';

// Ensure localStorage persistence so state is restored after redirect
setPersistence(auth, browserLocalPersistence).catch(() => {});

const isDev = process.env.NODE_ENV === 'development';
const authEnabled = process.env.REACT_APP_AUTH_ENABLED === 'true';

// Mock user (dev mode without auth enabled)
const MOCK_USER = {
  id: 'dev-user-123',
  name: 'Dev User',
  email: 'dev@example.com'
};

// Call getRedirectResult immediately on module load (runs once)
// This gets the result before React StrictMode remounts components
const redirectResultPromise = (isDev && !authEnabled)
  ? Promise.resolve(null)
  : (async () => {
    try {
      const result = await getRedirectResult(auth);
      if (result) {
        return {
          id: result.user.uid,
          name: result.user.displayName,
          email: result.user.email,
          photoURL: result.user.photoURL
        };
      }
      return null;
    } catch {
      return null; // Don't throw error, avoid blocking the app
    }
  })();

/**
 * Get login redirect result
 * Returns the result already obtained during module initialization
 */
export const handleRedirectResult = () => {
  return redirectResultPromise;
};

/**
 * Listen for authentication state changes
 * @param {Function} callback - Callback function, receives user object or null
 * @returns {Function} Unsubscribe function
 */
export const onAuthChange = (callback) => {
  if (isDev && !authEnabled) {
    callback(MOCK_USER);
    return () => { };
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
 * Get current logged in user
 * @returns {Object|null} User object or null
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
 * Check if user is logged in
 * @returns {boolean}
 */
export const isAuthenticated = () => {
  if (isDev && !authEnabled) {
    return true;
  }
  return auth.currentUser !== null;
};

/**
 * Detect if device is mobile
 */
const isMobile = () => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

/**
 * Google login
 * Desktop uses popup, mobile uses redirect (Firebase Hosting supported)
 */
export const loginWithGoogle = async () => {
  if (isDev && !authEnabled) {
    return MOCK_USER;
  }

  if (isMobile()) {
    await signInWithRedirect(auth, googleProvider);
    return null;
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
 * Twitter/X login
 * Desktop uses popup, mobile uses redirect
 */
export const loginWithTwitter = async () => {
  if (isDev && !authEnabled) {
    return MOCK_USER;
  }

  if (isMobile()) {
    await signInWithRedirect(auth, twitterProvider);
    return null;
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
 * Logout
 * @returns {Promise<void>}
 */
export const logout = async () => {
  if (isDev && !authEnabled) {
    return;
  }
  await signOut(auth);
};

/**
 * Get access token (for API calls)
 * @returns {Promise<string|null>}
 */
export const getAccessToken = async () => {
  if (isDev && !authEnabled) {
    return 'mock-token';
  }

  const user = auth.currentUser;
  if (user) {
    try {
      const token = await user.getIdToken(true);

      // Check token algorithm (HS256 is emulator token, not usable in production)
      const header = JSON.parse(atob(token.split('.')[0]));
      if (header.alg === 'HS256') {
        await signOut(auth);
        // Clear all Firebase-related IndexedDB data
        try {
          const databases = await indexedDB.databases();
          for (const db of databases) {
            if (db.name && db.name.includes('firebase')) {
              indexedDB.deleteDatabase(db.name);
            }
          }
        } catch {
          // ignore
        }
        window.location.reload();
        return null;
      }

      return token;
    } catch {
      return null;
    }
  }
  return null;
};
