/**
 * Tests for the visits service.
 *
 * Both ./auth and ./storage are fully mocked so we can test the business logic
 * in visits.js in isolation.  global.fetch is replaced with jest.fn() so all
 * HTTP calls are controllable.
 */

// Mock firebase dependencies so that loading auth.js (auto-mocked below)
// does not trigger real Firebase initialisation (which requires valid env vars).
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

jest.mock('../auth');
jest.mock('../storage');

// Pull the auto-mocked versions so we can configure return values per test.
const {
  getAccessToken,
  isAuthenticated,
} = require('../auth');

const {
  initDB,
  getAllVisits,
  addVisitToDB,
  removeVisitFromDB,
  clearAllVisits,
  migrateFromLocalStorage,
  addPendingOperation,
  getPendingOperations,
  removePendingOperation,
  clearPendingOperations,
} = require('../storage');

const {
  smartMerge,
  mergeAll,
  replaceCloudWithLocal,
  addVisitOptimistic,
  removeVisitOptimistic,
  toggleVisitOptimistic,
  syncPendingOperations,
  getPendingCount,
  clearLocalStorage,
  initLocalStorage,
  _resetSyncLockForTesting,
} = require('../visits');

// ---------------------------------------------------------------------------
// Test setup helpers
// ---------------------------------------------------------------------------

/** Sets all mocks to their most common happy-path defaults. */
const setupHappyPath = () => {
  getAccessToken.mockResolvedValue('real-token-abc');
  isAuthenticated.mockReturnValue(true);

  getAllVisits.mockResolvedValue(new Set());
  addVisitToDB.mockResolvedValue(undefined);
  removeVisitFromDB.mockResolvedValue(undefined);
  clearAllVisits.mockResolvedValue(undefined);
  migrateFromLocalStorage.mockResolvedValue({ migrated: false, count: 0 });
  initDB.mockResolvedValue({});

  addPendingOperation.mockResolvedValue(1);
  getPendingOperations.mockResolvedValue([]);
  removePendingOperation.mockResolvedValue(undefined);
  clearPendingOperations.mockResolvedValue(undefined);
};

beforeEach(() => {
  jest.clearAllMocks();
  setupHappyPath();
  _resetSyncLockForTesting();
  global.fetch = jest.fn();
  Object.defineProperty(navigator, 'onLine', {
    value: true,
    writable: true,
    configurable: true,
  });
});

// ---------------------------------------------------------------------------
// initLocalStorage
// ---------------------------------------------------------------------------

describe('initLocalStorage', () => {
  test('calls initDB then migrateFromLocalStorage', async () => {
    migrateFromLocalStorage.mockResolvedValue({ migrated: true, count: 5 });
    const result = await initLocalStorage();
    expect(initDB).toHaveBeenCalledTimes(1);
    expect(migrateFromLocalStorage).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ migrated: true, count: 5 });
  });
});

// ---------------------------------------------------------------------------
// smartMerge – all 7 branches
// ---------------------------------------------------------------------------

describe('smartMerge', () => {
  test('skip – no token', async () => {
    getAccessToken.mockResolvedValue(null);
    const result = await smartMerge();
    expect(result).toEqual({ action: 'skip', reason: 'not_logged_in' });
  });

  test('use_cloud – local is empty', async () => {
    getAllVisits.mockResolvedValue(new Set());
    getPendingOperations.mockResolvedValue([]);
    const result = await smartMerge();
    expect(result).toEqual({ action: 'use_cloud', reason: 'local_empty' });
  });

  test('uploaded_local – cloud is empty', async () => {
    getAllVisits.mockResolvedValue(new Set([1, 2, 3]));
    getPendingOperations.mockResolvedValue([]);
    global.fetch
      // GET /api/visits → empty cloud
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      // POST /api/visits/1, /2, /3 (inside mergeLocalToCloud)
      .mockResolvedValue({ ok: true });

    const result = await smartMerge();
    expect(result).toMatchObject({ action: 'uploaded_local', reason: 'cloud_empty' });
  });

  test('use_cloud – identical sets', async () => {
    getAllVisits.mockResolvedValue(new Set([1, 2, 3]));
    getPendingOperations.mockResolvedValue([]);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => [{ shrineId: 1 }, { shrineId: 2 }, { shrineId: 3 }],
    });
    const result = await smartMerge();
    expect(result).toMatchObject({ action: 'use_cloud', reason: 'identical' });
  });

  test('use_cloud – local is a strict subset of cloud', async () => {
    getAllVisits.mockResolvedValue(new Set([1, 2]));
    getPendingOperations.mockResolvedValue([]);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => [{ shrineId: 1 }, { shrineId: 2 }, { shrineId: 3 }],
    });
    const result = await smartMerge();
    expect(result).toMatchObject({ action: 'use_cloud', reason: 'local_subset' });
  });

  test('uploaded_local – cloud is a strict subset of local', async () => {
    getAllVisits.mockResolvedValue(new Set([1, 2, 3]));
    getPendingOperations.mockResolvedValue([]);
    global.fetch
      // GET → cloud has only 1, 2
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ shrineId: 1 }, { shrineId: 2 }],
      })
      // POST calls from mergeLocalToCloud
      .mockResolvedValue({ ok: true });

    const result = await smartMerge();
    expect(result).toMatchObject({ action: 'uploaded_local', reason: 'cloud_subset' });
  });

  test('ask_user – true conflict: each side has unique entries', async () => {
    getAllVisits.mockResolvedValue(new Set([1, 2, 4]));
    getPendingOperations.mockResolvedValue([]);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => [{ shrineId: 1 }, { shrineId: 2 }, { shrineId: 3 }],
    });
    const result = await smartMerge();
    expect(result.action).toBe('ask_user');
    expect(result.reason).toBe('conflict');
    expect(result.conflict.onlyLocal).toEqual([4]);
    expect(result.conflict.onlyCloud).toEqual([3]);
    expect(result.conflict.common.sort()).toEqual([1, 2]);
  });

  test('use_local – cloud fetch fails', async () => {
    getAllVisits.mockResolvedValue(new Set([1, 2]));
    getPendingOperations.mockResolvedValue([]);
    global.fetch.mockRejectedValue(new Error('Network error'));
    const result = await smartMerge();
    expect(result).toMatchObject({ action: 'use_local', reason: 'cloud_error' });
  });

  test('use_cloud after pending ops are fully synced', async () => {
    getPendingOperations.mockResolvedValue([
      { id: 1, action: 'add', shrineId: 5 },
    ]);
    global.fetch.mockResolvedValue({ ok: true }); // POST succeeds

    const result = await smartMerge();
    expect(result).toMatchObject({ action: 'use_cloud', reason: 'pending_synced' });
  });
});

// ---------------------------------------------------------------------------
// mergeAll
// ---------------------------------------------------------------------------

describe('mergeAll', () => {
  test('returns { merged: false } when not authenticated (null token)', async () => {
    getAccessToken.mockResolvedValue(null);
    const result = await mergeAll();
    expect(result.merged).toBe(false);
    expect(result.finalVisits).toBeInstanceOf(Set);
  });

  test('returns { merged: false } for mock-token', async () => {
    getAccessToken.mockResolvedValue('mock-token');
    const result = await mergeAll();
    expect(result.merged).toBe(false);
  });

  test('returns merged union of local and cloud visits', async () => {
    getAllVisits.mockResolvedValue(new Set([1, 2]));
    global.fetch
      // GET cloud: has 2 and 3
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ shrineId: 2 }, { shrineId: 3 }],
      })
      // POST for shrine 1 (only-local item)
      .mockResolvedValue({ ok: true });

    const result = await mergeAll();
    expect(result.merged).toBe(true);
    expect(result.finalVisits).toEqual(new Set([1, 2, 3]));
  });

  test('returns { merged: false } when cloud fetch throws', async () => {
    getAllVisits.mockResolvedValue(new Set([1]));
    global.fetch.mockRejectedValue(new Error('Network error'));
    const result = await mergeAll();
    expect(result.merged).toBe(false);
    expect(result.finalVisits).toBeInstanceOf(Set);
  });

  test('reports uploaded count correctly', async () => {
    getAllVisits.mockResolvedValue(new Set([10, 20, 30]));
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [], // cloud empty
      })
      .mockResolvedValue({ ok: true });

    const result = await mergeAll();
    expect(result.merged).toBe(true);
    expect(result.count).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// replaceCloudWithLocal
// ---------------------------------------------------------------------------

describe('replaceCloudWithLocal', () => {
  test('returns { replaced: false } when not authenticated', async () => {
    getAccessToken.mockResolvedValue(null);
    const result = await replaceCloudWithLocal([1]);
    expect(result.replaced).toBe(false);
  });

  test('returns { replaced: false } for mock-token', async () => {
    getAccessToken.mockResolvedValue('mock-token');
    const result = await replaceCloudWithLocal([1]);
    expect(result.replaced).toBe(false);
  });

  test('issues DELETE for every cloud-only id', async () => {
    getAllVisits.mockResolvedValue(new Set([10]));
    global.fetch.mockResolvedValue({ ok: true });

    await replaceCloudWithLocal([88, 99]);

    const deleteCalls = global.fetch.mock.calls.filter(
      ([, opts]) => opts.method === 'DELETE'
    );
    const deletedIds = deleteCalls
      .map(([url]) => Number(url.split('/').pop()))
      .sort((a, b) => a - b);
    expect(deletedIds).toEqual([88, 99]);
  });

  test('issues POST for every local visit', async () => {
    getAllVisits.mockResolvedValue(new Set([10, 20]));
    global.fetch.mockResolvedValue({ ok: true });

    await replaceCloudWithLocal([]);

    const postCalls = global.fetch.mock.calls.filter(
      ([, opts]) => opts.method === 'POST'
    );
    expect(postCalls).toHaveLength(2);
  });

  test('returns finalVisits equal to local data', async () => {
    getAllVisits.mockResolvedValue(new Set([10, 20]));
    global.fetch.mockResolvedValue({ ok: true });

    const result = await replaceCloudWithLocal([]);
    expect(result.replaced).toBe(true);
    expect(result.finalVisits).toEqual(new Set([10, 20]));
  });

  test('reports correct deleted and uploaded counts', async () => {
    getAllVisits.mockResolvedValue(new Set([10, 20]));
    global.fetch.mockResolvedValue({ ok: true });

    const result = await replaceCloudWithLocal([88, 99]);
    expect(result.deleted).toBe(2);
    expect(result.uploaded).toBe(2);
  });

  test('returns { replaced: false } when DELETE requests fail', async () => {
    getAllVisits.mockResolvedValue(new Set([10]));
    global.fetch.mockRejectedValue(new Error('Network error'));

    const result = await replaceCloudWithLocal([99]);
    expect(result.replaced).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// addVisitOptimistic / removeVisitOptimistic
// ---------------------------------------------------------------------------

describe('addVisitOptimistic', () => {
  test('always writes to local IndexedDB first', async () => {
    getAllVisits.mockResolvedValue(new Set([42]));
    isAuthenticated.mockReturnValue(false);

    await addVisitOptimistic(42);

    expect(addVisitToDB).toHaveBeenCalledWith(42);
  });

  test('returns updated visits Set from local storage', async () => {
    getAllVisits.mockResolvedValue(new Set([42]));
    isAuthenticated.mockReturnValue(false);

    const result = await addVisitOptimistic(42);
    expect(result).toBeInstanceOf(Set);
  });

  test('does not touch pending queue when user is not authenticated', async () => {
    getAllVisits.mockResolvedValue(new Set([42]));
    isAuthenticated.mockReturnValue(false);

    await addVisitOptimistic(42);

    // getPendingOperations is only called by addPendingOperationSmart
    expect(getPendingOperations).not.toHaveBeenCalled();
  });

  test('queues a pending operation when user is authenticated', async () => {
    getAllVisits.mockResolvedValue(new Set([42]));
    isAuthenticated.mockReturnValue(true);
    // No existing ops for this shrine → addPendingOperation will be called
    getPendingOperations.mockResolvedValue([]);
    getAccessToken.mockResolvedValue('real-token-abc');

    await addVisitOptimistic(42);

    expect(addPendingOperation).toHaveBeenCalledWith('add', 42);
  });
});

describe('removeVisitOptimistic', () => {
  test('always removes from local IndexedDB', async () => {
    getAllVisits.mockResolvedValue(new Set());
    isAuthenticated.mockReturnValue(false);

    await removeVisitOptimistic(42);

    expect(removeVisitFromDB).toHaveBeenCalledWith(42);
  });

  test('does not touch pending queue when user is not authenticated', async () => {
    getAllVisits.mockResolvedValue(new Set());
    isAuthenticated.mockReturnValue(false);

    await removeVisitOptimistic(42);

    expect(getPendingOperations).not.toHaveBeenCalled();
  });

  test('queues a remove pending operation when authenticated', async () => {
    getAllVisits.mockResolvedValue(new Set());
    isAuthenticated.mockReturnValue(true);
    getPendingOperations.mockResolvedValue([]);
    getAccessToken.mockResolvedValue('real-token-abc');

    await removeVisitOptimistic(42);

    expect(addPendingOperation).toHaveBeenCalledWith('remove', 42);
  });
});

// ---------------------------------------------------------------------------
// toggleVisitOptimistic
// ---------------------------------------------------------------------------

describe('toggleVisitOptimistic', () => {
  beforeEach(() => {
    getAllVisits.mockResolvedValue(new Set());
    isAuthenticated.mockReturnValue(false);
  });

  test('adds when shrine is NOT in current visits', async () => {
    await toggleVisitOptimistic(99, new Set([1, 2]));
    expect(addVisitToDB).toHaveBeenCalledWith(99);
    expect(removeVisitFromDB).not.toHaveBeenCalled();
  });

  test('removes when shrine IS in current visits', async () => {
    await toggleVisitOptimistic(1, new Set([1, 2]));
    expect(removeVisitFromDB).toHaveBeenCalledWith(1);
    expect(addVisitToDB).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// addPendingOperationSmart dedup logic (tested via addVisitOptimistic)
// ---------------------------------------------------------------------------

describe('addPendingOperationSmart deduplication (via addVisitOptimistic)', () => {
  beforeEach(() => {
    getAllVisits.mockResolvedValue(new Set());
    isAuthenticated.mockReturnValue(true);
    getAccessToken.mockResolvedValue('real-token-abc');
  });

  test('skips adding when the same action for same shrine is already queued', async () => {
    // Existing op: add 101
    getPendingOperations.mockResolvedValue([
      { id: 1, action: 'add', shrineId: 101 },
    ]);

    await addVisitOptimistic(101);

    // Should NOT call addPendingOperation (same action already in queue)
    expect(addPendingOperation).not.toHaveBeenCalled();
  });

  test('cancels out when opposite action for same shrine is queued (add cancels remove)', async () => {
    // Existing op: remove 101
    getPendingOperations.mockResolvedValue([
      { id: 7, action: 'remove', shrineId: 101 },
    ]);

    await addVisitOptimistic(101); // new action is 'add', opposite of existing 'remove'

    // Should remove the existing op and NOT add a new one
    expect(removePendingOperation).toHaveBeenCalledWith(7);
    expect(addPendingOperation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// syncPendingOperations
// ---------------------------------------------------------------------------

describe('syncPendingOperations', () => {
  test('does nothing when offline', async () => {
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true,
    });
    await syncPendingOperations();
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  test('does nothing when there is no token', async () => {
    getAccessToken.mockResolvedValue(null);
    await syncPendingOperations();
    expect(getPendingOperations).not.toHaveBeenCalled();
  });

  test('processes pending ops when online and authenticated', async () => {
    getPendingOperations.mockResolvedValue([
      { id: 1, action: 'add', shrineId: 50 },
    ]);
    global.fetch.mockResolvedValue({ ok: true });

    await syncPendingOperations();

    expect(global.fetch).toHaveBeenCalled();
    expect(removePendingOperation).toHaveBeenCalledWith(1);
  });
});

// ---------------------------------------------------------------------------
// getPendingCount
// ---------------------------------------------------------------------------

describe('getPendingCount', () => {
  test('returns 0 when the queue is empty', async () => {
    getPendingOperations.mockResolvedValue([]);
    expect(await getPendingCount()).toBe(0);
  });

  test('returns the number of pending operations', async () => {
    getPendingOperations.mockResolvedValue([
      { id: 1, action: 'add', shrineId: 10 },
      { id: 2, action: 'remove', shrineId: 20 },
    ]);
    expect(await getPendingCount()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// clearLocalStorage
// ---------------------------------------------------------------------------

describe('clearLocalStorage', () => {
  test('clears visits, pending ops, and the legacy localStorage key', async () => {
    localStorage.setItem('visited-shrines', '[1,2,3]');
    await clearLocalStorage();
    expect(clearAllVisits).toHaveBeenCalledTimes(1);
    expect(clearPendingOperations).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('visited-shrines')).toBeNull();
  });
});
