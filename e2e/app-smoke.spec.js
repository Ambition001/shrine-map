const { test, expect } = require('@playwright/test');
const { waitForAppReady, suppressMapboxErrors } = require('./fixtures');

test.describe('App Smoke Tests', () => {
  test('app loads and shows header with shrine count', async ({ page }) => {
    await suppressMapboxErrors(page);
    await page.goto('/');
    await waitForAppReady(page);
    // The header shows "全101社" (101 shrines have coordinates and appear in the map/list)
    await expect(page.getByText('全101社')).toBeVisible({ timeout: 15000 });
  });

  test('app shows the title 一之宮巡礼', async ({ page }) => {
    await suppressMapboxErrors(page);
    await page.goto('/');
    await waitForAppReady(page);
    await expect(page.getByText('一之宮巡礼')).toBeVisible({ timeout: 15000 });
  });

  test('can switch to list view and back to map view', async ({ page }) => {
    await suppressMapboxErrors(page);
    await page.goto('/');
    await waitForAppReady(page);

    // Switch to list view
    await page.locator('button', { hasText: 'リスト表示' }).click({ force: true });
    // Should show first region
    await expect(page.getByText('北海道・東北')).toBeVisible({ timeout: 10000 });

    // Switch back to map view
    await page.locator('button', { hasText: '地図表示' }).click({ force: true });
    // Map view button should still be visible (as active tab)
    await expect(page.getByText('地図表示')).toBeVisible();
  });

  test('list view shows shrine regions', async ({ page }) => {
    await suppressMapboxErrors(page);
    await page.goto('/');
    await waitForAppReady(page);
    await page.locator('button', { hasText: 'リスト表示' }).click({ force: true });
    // Multiple regions should be visible
    await expect(page.getByText('北海道・東北')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('関東')).toBeVisible({ timeout: 10000 });
  });

  test('list view shows shrine names', async ({ page }) => {
    await suppressMapboxErrors(page);
    await page.goto('/');
    await waitForAppReady(page);
    await page.locator('button', { hasText: 'リスト表示' }).click({ force: true });
    // First shrine in the first region
    await expect(page.getByText('北海道神宮')).toBeVisible({ timeout: 10000 });
  });
});
