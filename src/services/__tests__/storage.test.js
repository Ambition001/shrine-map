/**
 * Tests for IndexedDB storage service.
 *
 * Strategy: replace global.indexedDB with a fresh fake-indexeddb instance and
 * call jest.resetModules() before each test so the module-level `db` singleton
 * is always null at the start of every test.
 */

import { IDBFactory } from 'fake-indexeddb';

beforeEach(() => {
  global.indexedDB = new IDBFactory();
  jest.resetModules();
});

afterEach(() => {
  localStorage.clear();
});

// Re-require the module after resetting so the db singleton starts null.
const storage = () => require('../storage');

// ---------------------------------------------------------------------------
// initDB
// ---------------------------------------------------------------------------

describe('initDB', () => {
  test('creates visits and pending-operations object stores', async () => {
    const db = await storage().initDB();
    expect(db.objectStoreNames.contains('visits')).toBe(true);
    expect(db.objectStoreNames.contains('pending-operations')).toBe(true);
  });

  test('returns cached db instance on subsequent calls', async () => {
    const { initDB } = storage();
    const first = await initDB();
    const second = await initDB();
    expect(first).toBe(second);
  });
});

// ---------------------------------------------------------------------------
// visits store
// ---------------------------------------------------------------------------

describe('getAllVisits', () => {
  test('returns empty Set when nothing has been added', async () => {
    const { getAllVisits } = storage();
    const visits = await getAllVisits();
    expect(visits).toBeInstanceOf(Set);
    expect(visits.size).toBe(0);
  });
});

describe('addVisitToDB', () => {
  test('persists a visit record that can be retrieved', async () => {
    const { addVisitToDB, getAllVisits } = storage();
    await addVisitToDB(42);
    const visits = await getAllVisits();
    expect(visits.has(42)).toBe(true);
  });

  test('is idempotent – adding the same shrineId twice keeps size at 1', async () => {
    const { addVisitToDB, getAllVisits } = storage();
    await addVisitToDB(42);
    await addVisitToDB(42);
    const visits = await getAllVisits();
    expect(visits.size).toBe(1);
  });

  test('stores separate records for different shrine IDs', async () => {
    const { addVisitToDB, getAllVisits } = storage();
    await addVisitToDB(1);
    await addVisitToDB(2);
    await addVisitToDB(3);
    const visits = await getAllVisits();
    expect(visits).toEqual(new Set([1, 2, 3]));
  });
});

describe('removeVisitFromDB', () => {
  test('removes a previously added visit', async () => {
    const { addVisitToDB, removeVisitFromDB, getAllVisits } = storage();
    await addVisitToDB(42);
    await removeVisitFromDB(42);
    const visits = await getAllVisits();
    expect(visits.has(42)).toBe(false);
  });

  test('does not throw when removing a non-existent id', async () => {
    const { removeVisitFromDB } = storage();
    await expect(removeVisitFromDB(9999)).resolves.toBeUndefined();
  });
});

describe('clearAllVisits', () => {
  test('empties the visits store', async () => {
    const { addVisitToDB, clearAllVisits, getAllVisits } = storage();
    await addVisitToDB(1);
    await addVisitToDB(2);
    await clearAllVisits();
    const visits = await getAllVisits();
    expect(visits.size).toBe(0);
  });

  test('does not throw on an already-empty store', async () => {
    const { clearAllVisits } = storage();
    await expect(clearAllVisits()).resolves.toBeUndefined();
  });
});

describe('bulkAddVisits', () => {
  test('inserts all provided shrine IDs', async () => {
    const { bulkAddVisits, getAllVisits } = storage();
    await bulkAddVisits([10, 20, 30]);
    const visits = await getAllVisits();
    expect(visits).toEqual(new Set([10, 20, 30]));
  });

  test('handles an empty array without throwing', async () => {
    const { bulkAddVisits, getAllVisits } = storage();
    await bulkAddVisits([]);
    const visits = await getAllVisits();
    expect(visits.size).toBe(0);
  });

  test('is idempotent when duplicate IDs are present', async () => {
    const { bulkAddVisits, getAllVisits } = storage();
    await bulkAddVisits([5, 5, 5]);
    const visits = await getAllVisits();
    expect(visits.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// migrateFromLocalStorage
// ---------------------------------------------------------------------------

describe('migrateFromLocalStorage', () => {
  test('migrates valid data and removes the localStorage key', async () => {
    localStorage.setItem('visited-shrines', JSON.stringify([1, 2, 3]));
    const { migrateFromLocalStorage, getAllVisits } = storage();
    const result = await migrateFromLocalStorage();
    expect(result).toEqual({ migrated: true, count: 3 });
    const visits = await getAllVisits();
    expect(visits).toEqual(new Set([1, 2, 3]));
    expect(localStorage.getItem('visited-shrines')).toBeNull();
  });

  test('returns { migrated: false, count: 0 } when key is absent', async () => {
    const result = await storage().migrateFromLocalStorage();
    expect(result).toEqual({ migrated: false, count: 0 });
  });

  test('returns { migrated: false } for an empty array', async () => {
    localStorage.setItem('visited-shrines', JSON.stringify([]));
    const result = await storage().migrateFromLocalStorage();
    expect(result).toEqual({ migrated: false, count: 0 });
  });

  test('returns { migrated: false } for invalid JSON', async () => {
    localStorage.setItem('visited-shrines', 'not-valid-json!!!');
    const result = await storage().migrateFromLocalStorage();
    expect(result).toEqual({ migrated: false, count: 0 });
  });

  test('returns { migrated: false } for non-array JSON value', async () => {
    localStorage.setItem('visited-shrines', JSON.stringify({ id: 42 }));
    const result = await storage().migrateFromLocalStorage();
    expect(result).toEqual({ migrated: false, count: 0 });
  });
});

// ---------------------------------------------------------------------------
// hasLocalStorageData
// ---------------------------------------------------------------------------

describe('hasLocalStorageData', () => {
  test('returns true when a valid non-empty array is stored', () => {
    localStorage.setItem('visited-shrines', JSON.stringify([1, 2]));
    expect(storage().hasLocalStorageData()).toBe(true);
  });

  test('returns false when the key is absent', () => {
    expect(storage().hasLocalStorageData()).toBe(false);
  });

  test('returns false for an empty array', () => {
    localStorage.setItem('visited-shrines', JSON.stringify([]));
    expect(storage().hasLocalStorageData()).toBe(false);
  });

  test('returns false for malformed JSON', () => {
    localStorage.setItem('visited-shrines', '{bad-json');
    expect(storage().hasLocalStorageData()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// pending-operations store
// ---------------------------------------------------------------------------

describe('addPendingOperation', () => {
  test('returns a numeric auto-increment id', async () => {
    const id = await storage().addPendingOperation('add', 101);
    expect(typeof id).toBe('number');
  });

  test('stores the operation with action, shrineId and createdAt', async () => {
    const { addPendingOperation, getPendingOperations } = storage();
    await addPendingOperation('add', 101);
    const ops = await getPendingOperations();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ action: 'add', shrineId: 101 });
    expect(ops[0].createdAt).toBeTruthy();
    expect(new Date(ops[0].createdAt).getTime()).not.toBeNaN();
  });
});

describe('getPendingOperations', () => {
  test('returns an empty array initially', async () => {
    const ops = await storage().getPendingOperations();
    expect(ops).toEqual([]);
  });

  test('returns all inserted operations in insertion order', async () => {
    const { addPendingOperation, getPendingOperations } = storage();
    await addPendingOperation('add', 1);
    await addPendingOperation('add', 2);
    await addPendingOperation('remove', 3);
    const ops = await getPendingOperations();
    expect(ops).toHaveLength(3);
    expect(ops.map(o => o.shrineId)).toEqual([1, 2, 3]);
  });
});

describe('removePendingOperation', () => {
  test('deletes a specific operation by id, leaving others intact', async () => {
    const { addPendingOperation, getPendingOperations, removePendingOperation } = storage();
    const id1 = await addPendingOperation('add', 10);
    await addPendingOperation('add', 20);
    await removePendingOperation(id1);
    const ops = await getPendingOperations();
    expect(ops).toHaveLength(1);
    expect(ops[0].shrineId).toBe(20);
  });
});

describe('clearPendingOperations', () => {
  test('empties the pending-operations queue', async () => {
    const { addPendingOperation, clearPendingOperations, getPendingOperations } = storage();
    await addPendingOperation('add', 10);
    await addPendingOperation('remove', 20);
    await clearPendingOperations();
    const ops = await getPendingOperations();
    expect(ops).toHaveLength(0);
  });
});
