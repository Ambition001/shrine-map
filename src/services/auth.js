/**
 * Authentication Service - SuperTokens Implementation
 */
import Session from 'supertokens-web-js/recipe/session';
import { getAuthorisationURLWithQueryParamsAndSetState, signInAndUp } from 'supertokens-web-js/recipe/thirdparty';

const isDev = process.env.NODE_ENV === 'development';
const authEnabled = process.env.REACT_APP_AUTH_ENABLED === 'true';

// Mock user for dev mode without auth
const MOCK_USER = {
  id: 'dev-user-123',
  name: 'Dev User',
  email: 'dev@example.com'
};

// Internal state
let _user = null;
let _isLoaded = false;
let _authChangeCallbacks = [];

/**
 * Notify auth state change (called from AuthBridge component)
 * @internal
 */
export const _notifyAuthChange = (user, isLoaded) => {
  _user = user;
  _isLoaded = isLoaded;
  _authChangeCallbacks.forEach(cb => cb(user));
};

/**
 * Initialize session and get user info
 * Called when session exists
 */
export const initSession = async () => {
  if (isDev && !authEnabled) {
    return MOCK_USER;
  }

  try {
    const userId = await Session.getUserId();
    // Get additional user info from access token payload if available
    const accessTokenPayload = await Session.getAccessTokenPayloadSecurely();

    return {
      id: userId,
      name: accessTokenPayload?.name || 'User',
      email: accessTokenPayload?.email || null,
      photoURL: accessTokenPayload?.picture || null
    };
  } catch {
    return null;
  }
};

/**
 * Handle OAuth redirect result
 * Called after returning from Google/Twitter OAuth
 */
export const handleRedirectResult = async () => {
  if (isDev && !authEnabled) {
    return null;
  }

  try {
    const response = await signInAndUp();

    if (response.status === "OK") {
      const userInfo = await initSession();
      return userInfo;
    }
    return null;
  } catch {
    // Not a redirect callback, or error occurred
    return null;
  }
};

/**
 * Listen for authentication state changes
 * @param {Function} callback - Callback function, receives user object or null
 * @returns {Function} Unsubscribe function
 */
export const onAuthChange = (callback) => {
  if (isDev && !authEnabled) {
    callback(MOCK_USER);
    return () => {};
  }

  _authChangeCallbacks.push(callback);

  // If already loaded, call immediately with current state
  if (_isLoaded) {
    callback(_user);
  }

  // Return unsubscribe function
  return () => {
    _authChangeCallbacks = _authChangeCallbacks.filter(cb => cb !== callback);
  };
};

/**
 * Get current logged in user
 * @returns {Object|null} User object or null
 */
export const getCurrentUser = () => {
  if (isDev && !authEnabled) {
    return MOCK_USER;
  }
  return _user;
};

/**
 * Check if user is logged in
 * @returns {boolean}
 */
export const isAuthenticated = () => {
  if (isDev && !authEnabled) {
    return true;
  }
  return _user !== null;
};

/**
 * Google login - Redirects to Google OAuth
 */
export const loginWithGoogle = async () => {
  if (isDev && !authEnabled) {
    return MOCK_USER;
  }

  try {
    const authUrl = await getAuthorisationURLWithQueryParamsAndSetState({
      thirdPartyId: "google",
      frontendRedirectURI: `${window.location.origin}/auth/callback/google`
    });
    window.location.assign(authUrl);
  } catch (error) {
    console.error("Failed to start Google login:", error);
  }
  return null;
};

/**
 * Twitter/X login - Redirects to Twitter OAuth
 */
export const loginWithTwitter = async () => {
  if (isDev && !authEnabled) {
    return MOCK_USER;
  }

  try {
    const authUrl = await getAuthorisationURLWithQueryParamsAndSetState({
      thirdPartyId: "twitter",
      frontendRedirectURI: `${window.location.origin}/auth/callback/twitter`
    });
    window.location.assign(authUrl);
  } catch (error) {
    console.error("Failed to start Twitter login:", error);
  }
  return null;
};

/**
 * Logout
 * @returns {Promise<void>}
 */
export const logout = async () => {
  if (isDev && !authEnabled) {
    return;
  }

  try {
    await Session.signOut();
    _notifyAuthChange(null, true);
  } catch (error) {
    console.error("Logout failed:", error);
  }
};

/**
 * Get access token (for API calls)
 * With header-based auth, we need to get the actual JWT token
 * @returns {Promise<string|null>}
 */
export const getAccessToken = async () => {
  if (isDev && !authEnabled) {
    return 'mock-token';
  }

  try {
    const exists = await Session.doesSessionExist();
    if (exists) {
      // Get the actual access token for header-based auth
      const accessToken = await Session.getAccessToken();
      return accessToken || null;
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * Check if session exists
 * @returns {Promise<boolean>}
 */
export const doesSessionExist = async () => {
  if (isDev && !authEnabled) {
    return true;
  }

  try {
    return await Session.doesSessionExist();
  } catch {
    return false;
  }
};
