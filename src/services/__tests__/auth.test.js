/**
 * Tests for the authentication service.
 *
 * Both firebase/auth and ./firebase are fully mocked so tests never hit real
 * Firebase infrastructure.
 */

jest.mock('firebase/auth', () => ({
  signInWithPopup: jest.fn(),
  signInWithRedirect: jest.fn(() => Promise.resolve()),
  getRedirectResult: jest.fn(() => Promise.resolve(null)),
  signOut: jest.fn(() => Promise.resolve()),
  onAuthStateChanged: jest.fn(),
  browserLocalPersistence: { type: 'LOCAL' },
  setPersistence: jest.fn(() => Promise.resolve()),
}));

jest.mock('../firebase', () => ({
  auth: { currentUser: null },
  googleProvider: { providerId: 'google.com' },
  twitterProvider: { providerId: 'twitter.com' },
}));

const firebaseAuth = require('firebase/auth');
const { auth } = require('../firebase');
const authService = require('../auth');

afterEach(() => {
  // Clean up shared auth mock state
  auth.currentUser = null;
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// onAuthChange
// ---------------------------------------------------------------------------

describe('onAuthChange', () => {
  test('delegates to onAuthStateChanged', () => {
    firebaseAuth.onAuthStateChanged.mockReturnValue(() => {});
    authService.onAuthChange(jest.fn());
    expect(firebaseAuth.onAuthStateChanged).toHaveBeenCalledWith(
      auth,
      expect.any(Function)
    );
  });

  test('maps Firebase user fields to the app user shape', () => {
    const callback = jest.fn();
    const mockFirebaseUser = {
      uid: 'user-123',
      displayName: 'Test User',
      email: 'test@example.com',
      photoURL: 'https://photo.url/avatar.jpg',
    };

    firebaseAuth.onAuthStateChanged.mockImplementation((_auth, cb) => {
      cb(mockFirebaseUser);
      return () => {};
    });

    authService.onAuthChange(callback);

    expect(callback).toHaveBeenCalledWith({
      id: 'user-123',
      name: 'Test User',
      email: 'test@example.com',
      photoURL: 'https://photo.url/avatar.jpg',
    });
  });

  test('passes null to callback when user signs out', () => {
    const callback = jest.fn();
    firebaseAuth.onAuthStateChanged.mockImplementation((_auth, cb) => {
      cb(null);
      return () => {};
    });
    authService.onAuthChange(callback);
    expect(callback).toHaveBeenCalledWith(null);
  });

  test('returns the unsubscribe function', () => {
    const unsubscribe = jest.fn();
    firebaseAuth.onAuthStateChanged.mockReturnValue(unsubscribe);
    const result = authService.onAuthChange(jest.fn());
    expect(result).toBe(unsubscribe);
  });
});

// ---------------------------------------------------------------------------
// getCurrentUser
// ---------------------------------------------------------------------------

describe('getCurrentUser', () => {
  test('returns null when no user is logged in', () => {
    auth.currentUser = null;
    expect(authService.getCurrentUser()).toBeNull();
  });

  test('maps Firebase currentUser to the app user shape', () => {
    auth.currentUser = {
      uid: 'uid-456',
      displayName: 'Jane Doe',
      email: 'jane@example.com',
      photoURL: null,
    };
    expect(authService.getCurrentUser()).toEqual({
      id: 'uid-456',
      name: 'Jane Doe',
      email: 'jane@example.com',
      photoURL: null,
    });
  });
});

// ---------------------------------------------------------------------------
// isAuthenticated
// ---------------------------------------------------------------------------

describe('isAuthenticated', () => {
  test('returns false when currentUser is null', () => {
    auth.currentUser = null;
    expect(authService.isAuthenticated()).toBe(false);
  });

  test('returns true when currentUser is set', () => {
    auth.currentUser = { uid: 'user-789' };
    expect(authService.isAuthenticated()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loginWithGoogle
// ---------------------------------------------------------------------------

describe('loginWithGoogle', () => {
  const mockFirebaseUser = {
    uid: 'google-uid',
    displayName: 'Google User',
    email: 'google@gmail.com',
    photoURL: 'https://photo.google.com/avatar',
  };

  test('calls signInWithPopup on non-mobile user-agent', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      configurable: true,
    });
    firebaseAuth.signInWithPopup.mockResolvedValue({ user: mockFirebaseUser });

    const result = await authService.loginWithGoogle();

    expect(firebaseAuth.signInWithPopup).toHaveBeenCalled();
    expect(firebaseAuth.signInWithRedirect).not.toHaveBeenCalled();
    expect(result).toEqual({
      id: 'google-uid',
      name: 'Google User',
      email: 'google@gmail.com',
      photoURL: 'https://photo.google.com/avatar',
    });
  });

  test('calls signInWithRedirect on mobile user-agent and returns null', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
      configurable: true,
    });

    const result = await authService.loginWithGoogle();

    expect(firebaseAuth.signInWithRedirect).toHaveBeenCalled();
    expect(firebaseAuth.signInWithPopup).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getAccessToken
// ---------------------------------------------------------------------------

describe('getAccessToken', () => {
  test('returns null when no user is logged in', async () => {
    auth.currentUser = null;
    const token = await authService.getAccessToken();
    expect(token).toBeNull();
  });

  test('returns the token string for a valid RS256 JWT', async () => {
    // Build a minimal fake JWT with RS256 header (base64-encoded)
    const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = btoa(JSON.stringify({ uid: 'user-999', exp: 9999999999 }));
    const fakeToken = `${header}.${payload}.fake-signature`;

    auth.currentUser = {
      getIdToken: jest.fn().mockResolvedValue(fakeToken),
    };

    const token = await authService.getAccessToken();
    expect(token).toBe(fakeToken);
  });

  test('returns null when getIdToken throws', async () => {
    auth.currentUser = {
      getIdToken: jest.fn().mockRejectedValue(new Error('Token error')),
    };

    const token = await authService.getAccessToken();
    expect(token).toBeNull();
  });
});
