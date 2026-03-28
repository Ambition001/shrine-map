/**
 * Shared E2E test helpers.
 */

/**
 * Suppress Mapbox GL WebGL initialization errors in headless Chromium.
 * CRA's error overlay intercepts window.onerror and unhandledrejection.
 * This init script filters out known WebGL/Mapbox errors before the
 * overlay can capture them, keeping the app UI visible and testable.
 *
 * Call this BEFORE page.goto().
 */
async function suppressMapboxErrors(page) {
  // In headless Chromium, WebGL is not available. Mapbox GL's Map constructor
  // throws "Failed to initialize WebGL". App.js wraps the map init in a
  // try-catch so React doesn't crash, but the CRA dev-server error overlay
  // still intercepts the error event and blocks the UI.
  //
  // We suppress the error event in the capture phase so the CRA overlay
  // never activates. The app renders normally without the map.
  //
  // This must be called BEFORE page.goto().
  await page.addInitScript(() => {
    window.addEventListener(
      'error',
      (event) => {
        const msg = event?.message || (event?.error ? String(event.error) : '');
        if (
          msg.includes('WebGL') ||
          msg.includes('mapbox') ||
          msg.includes('Failed to initialize')
        ) {
          event.stopImmediatePropagation();
          event.preventDefault();
        }
      },
      true // capture phase — runs before CRA's bubble-phase listeners
    );

    window.addEventListener(
      'unhandledrejection',
      (event) => {
        const msg = event?.reason ? String(event.reason) : '';
        if (msg.includes('WebGL') || msg.includes('mapbox') || msg.includes('Failed to initialize')) {
          event.stopImmediatePropagation();
          event.preventDefault();
        }
      },
      true
    );
  });
}

/**
 * Seed IndexedDB with visit records before the page uses it.
 * Call AFTER page.goto() so the DB has been initialized.
 * Uses DB version 2 which has both 'visits' and 'pending-operations' stores.
 */
async function seedIndexedDBVisits(page, shrineIds) {
  await page.evaluate(async (ids) => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('shrine-map-db', 2);
      req.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains('visits')) {
          const store = database.createObjectStore('visits', { keyPath: 'shrineId' });
          store.createIndex('visitedAt', 'visitedAt', { unique: false });
        }
        if (!database.objectStoreNames.contains('pending-operations')) {
          database.createObjectStore('pending-operations', { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction('visits', 'readwrite');
        const store = tx.objectStore('visits');
        ids.forEach((id) => store.put({ shrineId: id, visitedAt: new Date().toISOString() }));
        tx.oncomplete = resolve;
        tx.onerror = reject;
      };
      req.onerror = reject;
    });
  }, shrineIds);
}

/**
 * Read all visit shrineIds currently stored in IndexedDB.
 */
async function getIndexedDBVisits(page) {
  return page.evaluate(() => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('shrine-map-db', 2);
      req.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains('visits')) {
          const store = database.createObjectStore('visits', { keyPath: 'shrineId' });
          store.createIndex('visitedAt', 'visitedAt', { unique: false });
        }
        if (!database.objectStoreNames.contains('pending-operations')) {
          database.createObjectStore('pending-operations', { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('visits')) {
          resolve([]);
          return;
        }
        const tx = db.transaction('visits', 'readonly');
        const store = tx.objectStore('visits');
        const all = store.getAll();
        all.onsuccess = () => resolve(all.result.map((r) => r.shrineId));
        all.onerror = reject;
      };
      req.onerror = () => resolve([]);
    });
  });
}

/**
 * Wait for the app to finish loading (spinner gone, header visible).
 * Must call suppressMapboxErrors(page) before page.goto() to prevent
 * CRA error overlay from blocking the UI in headless Chromium.
 */
async function waitForAppReady(page) {
  // Wait for loading overlay to disappear if present
  try {
    await page.waitForSelector('text=読み込み中', { state: 'hidden', timeout: 10000 });
  } catch {
    // Not present, that's fine
  }

  // Wait for the gradient header to appear
  await page.waitForSelector('.bg-gradient-to-r', { timeout: 15000 });
}

/**
 * Mock all /api/visits requests.
 * @param {import('@playwright/test').Page} page
 * @param {number[]} cloudShrineIds - shrine IDs to return from GET /api/visits
 */
async function mockApiVisits(page, cloudShrineIds = []) {
  await page.route('**/api/visits', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(cloudShrineIds.map((id) => ({ shrineId: id }))),
      });
    } else {
      await route.continue();
    }
  });

  await page.route('**/api/visits/**', async (route) => {
    await route.fulfill({
      status: route.request().method() === 'POST' ? 201 : 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    });
  });
}

module.exports = {
  suppressMapboxErrors,
  seedIndexedDBVisits,
  getIndexedDBVisits,
  waitForAppReady,
  mockApiVisits,
};
