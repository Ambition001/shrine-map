const { test, expect } = require('@playwright/test');
const { waitForAppReady, getIndexedDBVisits, suppressMapboxErrors } = require('./fixtures');

/**
 * Switch to list view and wait for shrine list to be visible.
 */
async function switchToListView(page) {
  await page.locator('button', { hasText: 'リスト表示' }).click({ force: true });
  // Wait for the region header to appear, confirming list rendered
  await expect(page.getByText('北海道・東北')).toBeVisible({ timeout: 10000 });
}

/**
 * Get the toggle button for a shrine card by index (0-based).
 */
async function getShrineToggleByIndex(page, index) {
  const shrineCard = page.locator('.bg-white.rounded-lg.shadow').nth(index);
  await expect(shrineCard).toBeVisible({ timeout: 10000 });
  return shrineCard.locator('button').first();
}

test.describe('Offline Sync', () => {
  test('online toggle updates IndexedDB', async ({ page }) => {
    await suppressMapboxErrors(page);
    await page.goto('/');
    await waitForAppReady(page);
    await switchToListView(page);

    const toggleBtn = await getShrineToggleByIndex(page, 0);
    await toggleBtn.click();

    // Give the async IndexedDB write a moment to complete
    await page.waitForTimeout(500);

    const visits = await getIndexedDBVisits(page);
    expect(visits.length).toBeGreaterThan(0);
    expect(visits).toContain(1);
  });

  test('offline toggle persists in IndexedDB', async ({ context, page }) => {
    await suppressMapboxErrors(page);
    await page.goto('/');
    await waitForAppReady(page);
    await switchToListView(page);

    await context.setOffline(true);

    const toggleBtn = await getShrineToggleByIndex(page, 0);
    await toggleBtn.click();

    await page.waitForTimeout(500);

    const visits = await getIndexedDBVisits(page);
    expect(visits).toContain(1);

    await context.setOffline(false);
  });

  test('reconnect after offline preserves changes', async ({ context, page }) => {
    await suppressMapboxErrors(page);
    await page.goto('/');
    await waitForAppReady(page);
    await switchToListView(page);

    await context.setOffline(true);

    const toggleBtn = await getShrineToggleByIndex(page, 0);
    await toggleBtn.click();
    await page.waitForTimeout(500);

    // Verify it's in IndexedDB while offline
    const offlineVisits = await getIndexedDBVisits(page);
    expect(offlineVisits).toContain(1);

    await context.setOffline(false);

    // Reload the page and suppress errors again
    await suppressMapboxErrors(page);
    await page.reload();
    await waitForAppReady(page);
    await switchToListView(page);

    // The first shrine card should show the visited badge
    const firstShrine = page.locator('.bg-white.rounded-lg.shadow').first();
    await expect(firstShrine.getByText('参拝済')).toBeVisible({ timeout: 5000 });
  });

  test('rapid offline toggling: net result is correct', async ({ context, page }) => {
    await suppressMapboxErrors(page);
    await page.goto('/');
    await waitForAppReady(page);
    await switchToListView(page);

    await context.setOffline(true);

    // Shrine at index 0 (id=1) — toggle on then off (net = unvisited)
    const toggleA = await getShrineToggleByIndex(page, 0);
    await toggleA.click(); // on
    await page.waitForTimeout(200);
    await toggleA.click(); // off
    await page.waitForTimeout(200);

    // Shrine at index 1 (id=2) — toggle on (net = visited)
    const toggleB = await getShrineToggleByIndex(page, 1);
    await toggleB.click(); // on
    await page.waitForTimeout(500);

    const visits = await getIndexedDBVisits(page);
    // Net result: exactly 1 shrine visited (shrine B at index 1)
    // Shrine A (index 0, id=1) was toggled on then off — should NOT be visited
    expect(visits).not.toContain(1);
    // Exactly one shrine should be in the visited list (shrine B)
    expect(visits.length).toBe(1);

    await context.setOffline(false);
  });
});
