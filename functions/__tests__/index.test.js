/**
 * Tests for the Firebase Cloud Function (functions/index.js).
 *
 * Strategy:
 *  - Use jest.resetModules() + jest.doMock() in beforeEach so each test gets a
 *    fresh module instance. This resets the module-level `container` and
 *    `cosmosClient` singletons, giving each test full control over the Cosmos
 *    mock without bleed-through between tests.
 *  - `onRequest` is mocked to return the raw handler so we can call it directly.
 *  - `defineSecret` is mocked to return an object whose `.value()` returns a
 *    non-empty string, satisfying the "configured" branch.
 */

let handler;         // the raw async (req, res) handler extracted from the module
let mockAdmin;       // configurable firebase-admin mock
let mockContainer;   // configurable Cosmos DB container mock

// ---------------------------------------------------------------------------
// Test lifecycle: reset module + rebuild mocks before every test
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Simulate the local emulator environment so mock-token is accepted by default
  process.env.FUNCTIONS_EMULATOR = 'true';

  jest.resetModules();

  // Build a fresh Cosmos container mock that tests can override
  mockContainer = {
    items: {
      query: jest.fn(() => ({
        fetchAll: jest.fn().mockResolvedValue({ resources: [] }),
      })),
      upsert: jest.fn().mockResolvedValue({}),
    },
    item: jest.fn(() => ({
      delete: jest.fn().mockResolvedValue({}),
    })),
  };

  // Build a fresh firebase-admin mock
  mockAdmin = {
    initializeApp: jest.fn(),
    auth: jest.fn(() => ({
      verifyIdToken: jest.fn().mockResolvedValue({ uid: 'user-abc' }),
    })),
  };

  jest.doMock('firebase-admin', () => mockAdmin);

  // Unwrap onRequest: return the handler directly so tests can call it
  jest.doMock('firebase-functions/v2/https', () => ({
    onRequest: (_opts, h) => h,
  }));

  // defineSecret returns an object whose .value() gives a non-empty string
  jest.doMock('firebase-functions/params', () => ({
    defineSecret: (name) => ({ value: () => `mock-${name}` }),
  }));

  jest.doMock('@azure/cosmos', () => ({
    CosmosClient: jest.fn(() => ({
      database: () => ({ container: () => mockContainer }),
    })),
  }));

  handler = require('../index').visits;
});

afterEach(() => {
  delete process.env.FUNCTIONS_EMULATOR;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock request object. */
const req = (overrides = {}) => ({
  headers: { authorization: 'Bearer mock-token' },
  method: 'GET',
  path: '/visits',
  ...overrides,
});

/** Build a mock response object that records status + json calls. */
const res = () => {
  const r = {};
  r.status = jest.fn(() => r);
  r.json = jest.fn(() => r);
  return r;
};

// ---------------------------------------------------------------------------
// verifyFirebaseToken – auth middleware
// ---------------------------------------------------------------------------

describe('auth middleware', () => {
  test('returns 401 when Authorization header is missing', async () => {
    const r = res();
    await handler(req({ headers: {} }), r);
    expect(r.status).toHaveBeenCalledWith(401);
  });

  test('returns 401 when Authorization header does not start with "Bearer "', async () => {
    const r = res();
    await handler(req({ headers: { authorization: 'Basic abc' } }), r);
    expect(r.status).toHaveBeenCalledWith(401);
  });

  test('accepts mock-token without calling verifyIdToken when FUNCTIONS_EMULATOR=true', async () => {
    process.env.FUNCTIONS_EMULATOR = 'true';
    const r = res();
    await handler(req({ headers: { authorization: 'Bearer mock-token' } }), r);
    expect(mockAdmin.auth).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(200);
    delete process.env.FUNCTIONS_EMULATOR;
  });

  test('returns dev-user-123 userId when FUNCTIONS_EMULATOR=true and token is mock-token', async () => {
    process.env.FUNCTIONS_EMULATOR = 'true';
    // Use GET so we reach the userId-dependent Cosmos query and can verify the userId
    const r = res();
    await handler(req({ method: 'GET', path: '/visits', headers: { authorization: 'Bearer mock-token' } }), r);
    expect(r.status).toHaveBeenCalledWith(200);
    // The Cosmos query must have been called with dev-user-123
    expect(mockContainer.items.query).toHaveBeenCalledWith(
      expect.objectContaining({
        parameters: expect.arrayContaining([
          expect.objectContaining({ name: '@userId', value: 'dev-user-123' }),
        ]),
      })
    );
    delete process.env.FUNCTIONS_EMULATOR;
  });

  test('rejects mock-token with 401 when FUNCTIONS_EMULATOR is not set', async () => {
    // Ensure FUNCTIONS_EMULATOR is unset for this test
    delete process.env.FUNCTIONS_EMULATOR;
    // firebase-admin verifyIdToken will throw (mock-token is not a real JWT)
    mockAdmin.auth.mockReturnValue({
      verifyIdToken: jest.fn().mockRejectedValue(new Error('Invalid token')),
    });
    const r = res();
    await handler(req({ headers: { authorization: 'Bearer mock-token' } }), r);
    expect(r.status).toHaveBeenCalledWith(401);
  });

  test('rejects mock-token with 401 when FUNCTIONS_EMULATOR is set to false', async () => {
    process.env.FUNCTIONS_EMULATOR = 'false';
    mockAdmin.auth.mockReturnValue({
      verifyIdToken: jest.fn().mockRejectedValue(new Error('Invalid token')),
    });
    const r = res();
    await handler(req({ headers: { authorization: 'Bearer mock-token' } }), r);
    expect(r.status).toHaveBeenCalledWith(401);
    delete process.env.FUNCTIONS_EMULATOR;
  });

  test('does not trigger mock bypass for non-mock tokens even when FUNCTIONS_EMULATOR=true', async () => {
    process.env.FUNCTIONS_EMULATOR = 'true';
    mockAdmin.auth.mockReturnValue({
      verifyIdToken: jest.fn().mockResolvedValue({ uid: 'real-user-xyz' }),
    });
    const r = res();
    await handler(req({ headers: { authorization: 'Bearer real.jwt.token' } }), r);
    // verifyIdToken must be called — the bypass must not have fired
    expect(mockAdmin.auth).toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(200);
    delete process.env.FUNCTIONS_EMULATOR;
  });

  test('accepts a real token verified by firebase-admin', async () => {
    mockAdmin.auth.mockReturnValue({
      verifyIdToken: jest.fn().mockResolvedValue({ uid: 'real-user-xyz' }),
    });
    const r = res();
    await handler(req({ headers: { authorization: 'Bearer real.jwt.token' } }), r);
    expect(mockAdmin.auth).toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(200);
  });

  test('returns 401 when verifyIdToken throws', async () => {
    mockAdmin.auth.mockReturnValue({
      verifyIdToken: jest.fn().mockRejectedValue(new Error('Token expired')),
    });
    const r = res();
    await handler(req({ headers: { authorization: 'Bearer expired.token' } }), r);
    expect(r.status).toHaveBeenCalledWith(401);
  });
});

// ---------------------------------------------------------------------------
// GET /visits
// ---------------------------------------------------------------------------

describe('GET /visits', () => {
  test('returns 200 with the visits array from Cosmos', async () => {
    const visits = [
      { id: 'visit_dev-user-123_1', userId: 'dev-user-123', shrineId: 1 },
      { id: 'visit_dev-user-123_2', userId: 'dev-user-123', shrineId: 2 },
    ];
    mockContainer.items.query.mockReturnValue({
      fetchAll: jest.fn().mockResolvedValue({ resources: visits }),
    });

    const r = res();
    await handler(req({ method: 'GET', path: '/visits' }), r);

    expect(r.status).toHaveBeenCalledWith(200);
    expect(r.json).toHaveBeenCalledWith(visits);
  });

  test('returns 200 with an empty array when user has no visits', async () => {
    const r = res();
    await handler(req({ method: 'GET', path: '/visits' }), r);
    expect(r.status).toHaveBeenCalledWith(200);
    expect(r.json).toHaveBeenCalledWith([]);
  });

  test('queries Cosmos with the correct userId', async () => {
    const r = res();
    await handler(req({ method: 'GET', path: '/visits' }), r);

    expect(mockContainer.items.query).toHaveBeenCalledWith(
      expect.objectContaining({
        parameters: expect.arrayContaining([
          expect.objectContaining({ name: '@userId', value: 'dev-user-123' }),
        ]),
      })
    );
  });

  test('returns 500 when Cosmos query throws', async () => {
    mockContainer.items.query.mockReturnValue({
      fetchAll: jest.fn().mockRejectedValue(new Error('Cosmos error')),
    });
    const r = res();
    await handler(req({ method: 'GET', path: '/visits' }), r);
    expect(r.status).toHaveBeenCalledWith(500);
  });
});

// ---------------------------------------------------------------------------
// POST /visits/:shrineId
// ---------------------------------------------------------------------------

describe('POST /visits/:shrineId', () => {
  test('returns 201 with the upserted visit record', async () => {
    const r = res();
    await handler(req({ method: 'POST', path: '/visits/42' }), r);

    expect(r.status).toHaveBeenCalledWith(201);
    const [body] = r.json.mock.calls[0];
    expect(body).toMatchObject({
      id: 'visit_dev-user-123_42',
      userId: 'dev-user-123',
      shrineId: 42,
    });
  });

  test('calls Cosmos upsert with the constructed visit document', async () => {
    const r = res();
    await handler(req({ method: 'POST', path: '/visits/42' }), r);

    expect(mockContainer.items.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'visit_dev-user-123_42',
        userId: 'dev-user-123',
        shrineId: 42,
      })
    );
  });

  test('returns 400 when shrineId is missing from path', async () => {
    const r = res();
    await handler(req({ method: 'POST', path: '/visits' }), r);
    expect(r.status).toHaveBeenCalledWith(400);
  });

  test('returns 500 when Cosmos upsert throws', async () => {
    mockContainer.items.upsert.mockRejectedValue(new Error('Write error'));
    const r = res();
    await handler(req({ method: 'POST', path: '/visits/42' }), r);
    expect(r.status).toHaveBeenCalledWith(500);
  });

  test('stores shrineId as a number (parseInt), not a string', async () => {
    const r = res();
    await handler(req({ method: 'POST', path: '/visits/99' }), r);
    const [body] = r.json.mock.calls[0];
    expect(typeof body.shrineId).toBe('number');
    expect(body.shrineId).toBe(99);
  });
});

// ---------------------------------------------------------------------------
// DELETE /visits/:shrineId
// ---------------------------------------------------------------------------

describe('DELETE /visits/:shrineId', () => {
  test('returns 200 on successful deletion', async () => {
    const r = res();
    await handler(req({ method: 'DELETE', path: '/visits/42' }), r);
    expect(r.status).toHaveBeenCalledWith(200);
    expect(r.json).toHaveBeenCalledWith({ success: true });
  });

  test('calls Cosmos item().delete() with correct id and partition key', async () => {
    const r = res();
    await handler(req({ method: 'DELETE', path: '/visits/42' }), r);
    expect(mockContainer.item).toHaveBeenCalledWith(
      'visit_dev-user-123_42',
      'dev-user-123'
    );
  });

  test('returns 200 even when the record does not exist in Cosmos (404)', async () => {
    const notFoundError = new Error('Not Found');
    notFoundError.code = 404;
    mockContainer.item.mockReturnValue({
      delete: jest.fn().mockRejectedValue(notFoundError),
    });

    const r = res();
    await handler(req({ method: 'DELETE', path: '/visits/42' }), r);
    expect(r.status).toHaveBeenCalledWith(200);
    expect(r.json).toHaveBeenCalledWith({ success: true });
  });

  test('returns 400 when shrineId is missing from path', async () => {
    const r = res();
    await handler(req({ method: 'DELETE', path: '/visits' }), r);
    expect(r.status).toHaveBeenCalledWith(400);
  });

  test('returns 500 when Cosmos delete throws a non-404 error', async () => {
    const serverError = new Error('Internal Cosmos error');
    serverError.code = 500;
    mockContainer.item.mockReturnValue({
      delete: jest.fn().mockRejectedValue(serverError),
    });

    const r = res();
    await handler(req({ method: 'DELETE', path: '/visits/42' }), r);
    expect(r.status).toHaveBeenCalledWith(500);
  });
});

// ---------------------------------------------------------------------------
// Unsupported methods
// ---------------------------------------------------------------------------

describe('unsupported HTTP methods', () => {
  test('returns 405 for PATCH', async () => {
    const r = res();
    await handler(req({ method: 'PATCH', path: '/visits' }), r);
    expect(r.status).toHaveBeenCalledWith(405);
  });

  test('returns 405 for PUT', async () => {
    const r = res();
    await handler(req({ method: 'PUT', path: '/visits/1' }), r);
    expect(r.status).toHaveBeenCalledWith(405);
  });
});

// ---------------------------------------------------------------------------
// Cosmos DB configuration missing → 503
// ---------------------------------------------------------------------------

describe('Cosmos DB configuration', () => {
  test('returns 503 when secrets are empty strings', async () => {
    // Override defineSecret to return empty strings → getContainer will throw
    jest.resetModules();
    jest.doMock('firebase-admin', () => mockAdmin);
    jest.doMock('firebase-functions/v2/https', () => ({
      onRequest: (_opts, h) => h,
    }));
    jest.doMock('firebase-functions/params', () => ({
      defineSecret: () => ({ value: () => '' }), // empty → missing config
    }));
    jest.doMock('@azure/cosmos', () => ({
      CosmosClient: jest.fn(),
    }));

    const freshHandler = require('../index').visits;
    const r = res();
    await freshHandler(req({ headers: { authorization: 'Bearer mock-token' } }), r);
    expect(r.status).toHaveBeenCalledWith(503);
  });
});

// ---------------------------------------------------------------------------
// shrineId bounds validation (M2)
// ---------------------------------------------------------------------------

describe('shrineId bounds validation', () => {
  test('POST /visits/0 returns 400', async () => {
    const r = res();
    await handler(req({ method: 'POST', path: '/visits/0' }), r);
    expect(r.status).toHaveBeenCalledWith(400);
  });

  test('POST /visits/106 returns 400', async () => {
    const r = res();
    await handler(req({ method: 'POST', path: '/visits/106' }), r);
    expect(r.status).toHaveBeenCalledWith(400);
  });

  test('POST /visits/1 returns 201 (valid lower boundary)', async () => {
    const r = res();
    await handler(req({ method: 'POST', path: '/visits/1' }), r);
    expect(r.status).toHaveBeenCalledWith(201);
  });

  test('POST /visits/105 returns 201 (valid upper boundary)', async () => {
    const r = res();
    await handler(req({ method: 'POST', path: '/visits/105' }), r);
    expect(r.status).toHaveBeenCalledWith(201);
  });

  test('DELETE /visits/0 returns 400', async () => {
    const r = res();
    await handler(req({ method: 'DELETE', path: '/visits/0' }), r);
    expect(r.status).toHaveBeenCalledWith(400);
  });

  test('DELETE /visits/106 returns 400', async () => {
    const r = res();
    await handler(req({ method: 'DELETE', path: '/visits/106' }), r);
    expect(r.status).toHaveBeenCalledWith(400);
  });
});

// ---------------------------------------------------------------------------
// getContainer singleton caching
// ---------------------------------------------------------------------------

describe('getContainer singleton', () => {
  test('reuses the same container instance across multiple requests', async () => {
    const { CosmosClient } = require('@azure/cosmos');
    const r1 = res();
    const r2 = res();

    await handler(req(), r1);
    await handler(req(), r2);

    // CosmosClient constructor should only be called once (lazy-init singleton)
    expect(CosmosClient).toHaveBeenCalledTimes(1);
  });
});
