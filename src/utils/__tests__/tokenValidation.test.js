/**
 * Tests for src/utils/tokenValidation.js
 *
 * validateEnvConfig() inspects process.env at call time, so we restore the
 * original env after every test to keep tests isolated.
 */

import { validateEnvConfig } from '../tokenValidation';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Snapshot env vars that validateEnvConfig cares about, restore after test. */
const WATCHED_VARS = [
  'REACT_APP_MAPBOX_TOKEN',
  'REACT_APP_FIREBASE_API_KEY',
  'REACT_APP_FIREBASE_AUTH_DOMAIN',
  'REACT_APP_FIREBASE_PROJECT_ID',
  'REACT_APP_FIREBASE_STORAGE_BUCKET',
  'REACT_APP_FIREBASE_MESSAGING_SENDER_ID',
  'REACT_APP_FIREBASE_APP_ID',
];

let savedEnv;

beforeEach(() => {
  savedEnv = {};
  WATCHED_VARS.forEach((key) => {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  });
  // Suppress console.warn output during tests
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  WATCHED_VARS.forEach((key) => {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  });
  jest.restoreAllMocks();
});

/** Set all required env vars to non-empty values. */
function setAllVars(overrides = {}) {
  const defaults = {
    REACT_APP_MAPBOX_TOKEN: 'pk.test_token',
    REACT_APP_FIREBASE_API_KEY: 'firebase-api-key',
    REACT_APP_FIREBASE_AUTH_DOMAIN: 'test.firebaseapp.com',
    REACT_APP_FIREBASE_PROJECT_ID: 'test-project',
    REACT_APP_FIREBASE_STORAGE_BUCKET: 'test.appspot.com',
    REACT_APP_FIREBASE_MESSAGING_SENDER_ID: '123456789',
    REACT_APP_FIREBASE_APP_ID: '1:123:web:abc',
  };
  Object.assign(process.env, defaults, overrides);
}

// ---------------------------------------------------------------------------
// Return shape
// ---------------------------------------------------------------------------

describe('return shape', () => {
  test('returns an object with valid, missing, and warnings fields', () => {
    setAllVars();
    const result = validateEnvConfig();
    expect(result).toHaveProperty('valid');
    expect(result).toHaveProperty('missing');
    expect(result).toHaveProperty('warnings');
    expect(typeof result.valid).toBe('boolean');
    expect(Array.isArray(result.missing)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Missing env var detection
// ---------------------------------------------------------------------------

describe('missing env var detection', () => {
  test('valid is true and missing is empty when all required vars are present', () => {
    setAllVars();
    const result = validateEnvConfig();
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  test('valid is false and lists REACT_APP_MAPBOX_TOKEN when it is absent', () => {
    setAllVars({ REACT_APP_MAPBOX_TOKEN: undefined });
    delete process.env.REACT_APP_MAPBOX_TOKEN;
    const result = validateEnvConfig();
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('REACT_APP_MAPBOX_TOKEN');
  });

  test('valid is false and lists REACT_APP_FIREBASE_API_KEY when it is absent', () => {
    setAllVars({ REACT_APP_FIREBASE_API_KEY: undefined });
    delete process.env.REACT_APP_FIREBASE_API_KEY;
    const result = validateEnvConfig();
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('REACT_APP_FIREBASE_API_KEY');
  });

  test('valid is false and lists all missing vars when multiple are absent', () => {
    // All vars deleted in beforeEach — do not call setAllVars
    const result = validateEnvConfig();
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('REACT_APP_MAPBOX_TOKEN');
    expect(result.missing).toContain('REACT_APP_FIREBASE_API_KEY');
  });

  test('treats an empty-string value as missing', () => {
    setAllVars({ REACT_APP_MAPBOX_TOKEN: '' });
    const result = validateEnvConfig();
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('REACT_APP_MAPBOX_TOKEN');
  });

  test('treats a whitespace-only value as missing', () => {
    setAllVars({ REACT_APP_MAPBOX_TOKEN: '   ' });
    const result = validateEnvConfig();
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('REACT_APP_MAPBOX_TOKEN');
  });
});

// ---------------------------------------------------------------------------
// Mapbox development token warning
// ---------------------------------------------------------------------------

describe('Mapbox development token warning', () => {
  test('includes a warning when REACT_APP_MAPBOX_TOKEN starts with pk. in development', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    // react-scripts sets NODE_ENV=test; force development for this assertion
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'development',
      writable: true,
      configurable: true,
    });
    setAllVars({ REACT_APP_MAPBOX_TOKEN: 'pk.live_token_abc' });

    const result = validateEnvConfig();

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes('REACT_APP_MAPBOX_TOKEN'))).toBe(true);

    Object.defineProperty(process.env, 'NODE_ENV', {
      value: originalNodeEnv,
      writable: true,
      configurable: true,
    });
  });

  test('does not warn about Mapbox token in production', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'production',
      writable: true,
      configurable: true,
    });
    setAllVars({ REACT_APP_MAPBOX_TOKEN: 'pk.live_token_abc' });

    const result = validateEnvConfig();

    // Either no warnings, or any present do not mention domain restrictions
    const hasDomainWarning = result.warnings.some(
      (w) => w.includes('REACT_APP_MAPBOX_TOKEN') && w.toLowerCase().includes('domain')
    );
    expect(hasDomainWarning).toBe(false);

    Object.defineProperty(process.env, 'NODE_ENV', {
      value: originalNodeEnv,
      writable: true,
      configurable: true,
    });
  });

  test('does not warn about Mapbox token when it does not start with pk.', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'development',
      writable: true,
      configurable: true,
    });
    setAllVars({ REACT_APP_MAPBOX_TOKEN: 'sk.secret_token' });

    const result = validateEnvConfig();

    const hasMapboxDomainWarning = result.warnings.some(
      (w) => w.includes('REACT_APP_MAPBOX_TOKEN') && w.toLowerCase().includes('domain')
    );
    expect(hasMapboxDomainWarning).toBe(false);

    Object.defineProperty(process.env, 'NODE_ENV', {
      value: originalNodeEnv,
      writable: true,
      configurable: true,
    });
  });
});

// ---------------------------------------------------------------------------
// console.warn in development
// ---------------------------------------------------------------------------

describe('console.warn side effect', () => {
  test('calls console.warn in development when REACT_APP_MAPBOX_TOKEN starts with pk.', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'development',
      writable: true,
      configurable: true,
    });
    setAllVars({ REACT_APP_MAPBOX_TOKEN: 'pk.something' });

    validateEnvConfig();

    expect(console.warn).toHaveBeenCalled();

    Object.defineProperty(process.env, 'NODE_ENV', {
      value: originalNodeEnv,
      writable: true,
      configurable: true,
    });
  });

  test('does not call console.warn when all vars are present and no pk. token in non-development', () => {
    // NODE_ENV is 'test' in Jest — not 'development'
    setAllVars({ REACT_APP_MAPBOX_TOKEN: 'pk.something' });

    validateEnvConfig();

    expect(console.warn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  test('is callable multiple times without throwing', () => {
    setAllVars();
    expect(() => {
      validateEnvConfig();
      validateEnvConfig();
      validateEnvConfig();
    }).not.toThrow();
  });

  test('missing field is not listed twice even if called multiple times', () => {
    // All vars are deleted in beforeEach
    const result = validateEnvConfig();
    const mapboxCount = result.missing.filter(
      (m) => m === 'REACT_APP_MAPBOX_TOKEN'
    ).length;
    expect(mapboxCount).toBe(1);
  });
});
