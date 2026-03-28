const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  // 90s per test in CI (webpack compilation + app load can take 30-60s on first run)
  timeout: process.env.CI ? 90000 : 30000,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-gl=swiftshader',          // software WebGL for Mapbox
            '--disable-dev-shm-usage',        // avoid /dev/shm crashes in CI
          ],
        },
      },
    },
  ],
  webServer: {
    command: 'npm start',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    // Give webpack up to 3 minutes to compile the initial bundle in CI
    timeout: 180000,
    env: {
      REACT_APP_AUTH_ENABLED: 'false',
      PORT: '3001',
      BROWSER: 'none',   // prevent CRA from trying to open a browser
      CI: 'false',       // CRA sets CI=true which treats warnings as errors; keep permissive
    },
  },
});
