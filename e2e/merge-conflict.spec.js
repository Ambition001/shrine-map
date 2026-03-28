const { test, expect } = require('@playwright/test');
const { waitForAppReady, mockApiVisits, suppressMapboxErrors } = require('./fixtures');

const CONFLICT_DATA = {
  type: 'conflict',
  onlyLocalCount: 3,
  onlyCloudCount: 2,
  commonCount: 5,
  onlyCloud: [201, 202],
};

async function openMergeDialog(page) {
  await suppressMapboxErrors(page);
  await mockApiVisits(page, []);
  await page.goto('/');
  await waitForAppReady(page);
  // Trigger the merge conflict dialog via the E2E hook
  await page.evaluate((data) => {
    if (window.__E2E__) window.__E2E__.triggerMergeDialog(data);
  }, CONFLICT_DATA);
  // Wait for the dialog title to appear
  await expect(page.getByText('データの競合が見つかりました')).toBeVisible({ timeout: 5000 });
}

test.describe('Merge Conflict Dialog', () => {
  test('dialog displays correct conflict statistics', async ({ page }) => {
    await openMergeDialog(page);

    // Should show the dialog title
    await expect(page.getByText('データの競合が見つかりました')).toBeVisible();

    // Should show counts — onlyLocalCount=3, onlyCloudCount=2, commonCount=5
    await expect(page.getByText('このデバイスのみ:', { exact: false })).toBeVisible();
    await expect(page.getByText('クラウドのみ:', { exact: false })).toBeVisible();
    await expect(page.getByText('両方に存在:', { exact: false })).toBeVisible();

    // All three action buttons should be visible
    await expect(page.getByText('すべて合併する（推奨）')).toBeVisible();
    await expect(page.getByText('クラウドのみ使用')).toBeVisible();
    await expect(page.getByText('このデバイスのみ使用')).toBeVisible();
  });

  test('"Merge All" resolves conflict and closes dialog', async ({ page }) => {
    await openMergeDialog(page);
    await page.getByText('すべて合併する（推奨）').click();
    // Dialog should close — title no longer visible
    await expect(page.getByText('データの競合が見つかりました')).not.toBeVisible({ timeout: 5000 });
  });

  test('"Use Cloud" resolves conflict and closes dialog', async ({ page }) => {
    await openMergeDialog(page);
    await page.getByText('クラウドのみ使用').click();
    await expect(page.getByText('データの競合が見つかりました')).not.toBeVisible({ timeout: 5000 });
  });

  test('"Use Local" resolves conflict and closes dialog', async ({ page }) => {
    await openMergeDialog(page);
    await page.getByText('このデバイスのみ使用').click();
    await expect(page.getByText('データの競合が見つかりました')).not.toBeVisible({ timeout: 5000 });
  });
});
