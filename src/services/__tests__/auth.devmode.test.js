/**
 * Tests for auth service behavior in development mode (auth disabled).
 *
 * These tests use jest.resetModules() to load auth.js fresh with
 * NODE_ENV=development and REACT_APP_AUTH_ENABLED unset, so the
 * isDev && !authEnabled branches execute.
 *
 * IMPORTANT: jest.mock() calls must live inside beforeEach (not at the top
 * level) because jest.resetModules() clears the module registry — top-level
 * mocks are registered once before the first test and become stale after the
 * reset. Re-declaring them in beforeEach ensures each fresh module load sees
 * the correct mocks.
 */

describe('getAccessToken – dev mode (auth disabled)', () => {
  let authService;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAuthEnabled = process.env.REACT_APP_AUTH_ENABLED;

  beforeEach(() => {
    // Force dev mode without auth enabled
    process.env.NODE_ENV = 'development';
    delete process.env.REACT_APP_AUTH_ENABLED;

    jest.resetModules();
    // Re-declare mocks AFTER resetModules so the fresh module load sees them
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

    authService = require('../auth');
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalAuthEnabled !== undefined) {
      process.env.REACT_APP_AUTH_ENABLED = originalAuthEnabled;
    } else {
      delete process.env.REACT_APP_AUTH_ENABLED;
    }
    jest.resetModules();
  });

  test('returns null (not mock-token) when auth is disabled in dev mode', async () => {
    const token = await authService.getAccessToken();
    expect(token).toBeNull();
    // Explicit: must NOT return the string 'mock-token'
    expect(token).not.toBe('mock-token');
  });
});

// ---------------------------------------------------------------------------
// HIGH-3: getAccessToken – HS256 token detection and malformed token handling
// ---------------------------------------------------------------------------

/**
 * Helper: encode a JWT-like header for testing purposes.
 * btoa is available in Node via global setup in jest / jsdom.
 */
function makeToken(headerObj) {
  const header = btoa(JSON.stringify(headerObj));
  return `${header}.payload.signature`;
}

describe('getAccessToken – HIGH-3: HS256 emulator token detection', () => {
  let authService;
  let getIdTokenMock;
  let signOutMock;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAuthEnabled = process.env.REACT_APP_AUTH_ENABLED;

  beforeEach(() => {
    // Production mode with auth enabled so the HS256 branch is reachable
    process.env.NODE_ENV = 'production';
    process.env.REACT_APP_AUTH_ENABLED = 'true';

    jest.resetModules();

    getIdTokenMock = jest.fn();
    signOutMock = jest.fn(() => Promise.resolve());

    // Use jest.doMock (not hoisted) so closures over local variables work
    jest.doMock('firebase/auth', () => ({
      signInWithPopup: jest.fn(),
      signInWithRedirect: jest.fn(() => Promise.resolve()),
      getRedirectResult: jest.fn(() => Promise.resolve(null)),
      signOut: signOutMock,
      onAuthStateChanged: jest.fn(),
      browserLocalPersistence: { type: 'LOCAL' },
      setPersistence: jest.fn(() => Promise.resolve()),
    }));

    jest.doMock('../firebase', () => ({
      auth: {
        currentUser: { getIdToken: getIdTokenMock },
      },
      googleProvider: { providerId: 'google.com' },
      twitterProvider: { providerId: 'twitter.com' },
    }));

    // Mock window.location.reload and indexedDB.databases
    delete window.location;
    window.location = { reload: jest.fn() };
    global.indexedDB = { databases: jest.fn().mockResolvedValue([]) };

    authService = require('../auth');
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalAuthEnabled !== undefined) {
      process.env.REACT_APP_AUTH_ENABLED = originalAuthEnabled;
    } else {
      delete process.env.REACT_APP_AUTH_ENABLED;
    }
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('HIGH-3: emits console.warn before reloading when HS256 token detected', async () => {
    getIdTokenMock.mockResolvedValue(makeToken({ alg: 'HS256' }));

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await authService.getAccessToken();

    // Must emit a console.warn so developers can debug the emulator token issue
    expect(warnSpy).toHaveBeenCalled();
    const warnMessage = warnSpy.mock.calls[0][0];
    expect(typeof warnMessage).toBe('string');
    expect(warnMessage.length).toBeGreaterThan(0);

    warnSpy.mockRestore();
  });

  test('HIGH-3: malformed token (non-base64 header) returns null without throwing', async () => {
    // A token with an invalid base64 header that will throw in atob/JSON.parse
    getIdTokenMock.mockResolvedValue('not-valid-base64!!!.payload.sig');

    const result = await authService.getAccessToken();

    // Must return null (not throw) when token header is malformed
    expect(result).toBeNull();
  });

  test('HIGH-3: malformed token does not call signOut or reload (decode error ≠ HS256)', async () => {
    getIdTokenMock.mockResolvedValue('!!!bad!!!.payload.sig');

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await authService.getAccessToken();

    // A decode error is a different failure than HS256 detection.
    // signOut and reload must NOT be triggered for malformed tokens.
    expect(signOutMock).not.toHaveBeenCalled();
    expect(window.location.reload).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  test('HIGH-3: valid RS256 token is returned normally', async () => {
    const validToken = makeToken({ alg: 'RS256' });
    getIdTokenMock.mockResolvedValue(validToken);

    const result = await authService.getAccessToken();

    expect(result).toBe(validToken);
    expect(window.location.reload).not.toHaveBeenCalled();
  });
});

describe('onAuthChange – dev mode (auth disabled)', () => {
  let authService;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAuthEnabled = process.env.REACT_APP_AUTH_ENABLED;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    delete process.env.REACT_APP_AUTH_ENABLED;

    jest.resetModules();
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

    authService = require('../auth');
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalAuthEnabled !== undefined) {
      process.env.REACT_APP_AUTH_ENABLED = originalAuthEnabled;
    } else {
      delete process.env.REACT_APP_AUTH_ENABLED;
    }
    jest.resetModules();
  });

  test('immediately calls callback with MOCK_USER in dev mode', () => {
    const callback = jest.fn();
    authService.onAuthChange(callback);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'dev-user-123' })
    );
  });

  test('returns a no-op unsubscribe function in dev mode', () => {
    const unsubscribe = authService.onAuthChange(jest.fn());
    expect(typeof unsubscribe).toBe('function');
    // Should not throw when called
    expect(() => unsubscribe()).not.toThrow();
  });
});
