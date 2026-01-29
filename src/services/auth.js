/**
 * Authentication Service - Clerk Implementation
 */

const isDev = process.env.NODE_ENV === 'development';
const authEnabled = process.env.REACT_APP_AUTH_ENABLED === 'true';

// Mock user for dev mode without auth
const MOCK_USER = {
  id: 'dev-user-123',
  name: 'Dev User',
  email: 'dev@example.com'
};

// Clerk instance reference (set from React component via ClerkBridge)
let _clerk = null;
let _user = null;
let _isLoaded = false;
let _authChangeCallbacks = [];
let _getToken = null; // getToken function from useAuth()

/**
 * Set Clerk instance (called from ClerkBridge component)
 * @internal
 */
export const _setClerkInstance = (clerk) => {
  _clerk = clerk;
};

/**
 * Set getToken function (called from ClerkBridge component)
 * @internal
 */
export const _setGetToken = (getTokenFn) => {
  _getToken = getTokenFn;
};

/**
 * Notify auth state change (called from ClerkBridge component)
 * @internal
 */
export const _notifyAuthChange = (user, isLoaded) => {
  _user = user;
  _isLoaded = isLoaded;
  _authChangeCallbacks.forEach(cb => cb(user));
};

/**
 * Get login redirect result
 * Not needed for Clerk (handles redirects internally)
 */
export const handleRedirectResult = () => {
  return Promise.resolve(null);
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
 * Google login - Opens Clerk sign-in modal
 */
export const loginWithGoogle = async () => {
  if (isDev && !authEnabled) {
    return MOCK_USER;
  }

  _clerk?.openSignIn();
  return null;
};

/**
 * Twitter/X login - Opens Clerk sign-in modal
 */
export const loginWithTwitter = async () => {
  if (isDev && !authEnabled) {
    return MOCK_USER;
  }

  _clerk?.openSignIn();
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
  await _clerk?.signOut();
};

/**
 * Get access token (for API calls)
 * @returns {Promise<string|null>}
 */
export const getAccessToken = async () => {
  if (isDev && !authEnabled) {
    return 'mock-token';
  }

  try {
    // Use getToken from useAuth() hook (passed via ClerkBridge)
    if (_getToken) {
      const token = await _getToken();
      return token || null;
    }
    return null;
  } catch {
    return null;
  }
};
