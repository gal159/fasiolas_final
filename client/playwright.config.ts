import { defineConfig } from '@playwright/test'

// E2E: `npx playwright test` paleidzia serveri ir klienta pats.
// Serveris naudoja atskira laikina DB (DATA_DIR), todel server/data/auth-users.db nesikeicia.
// Konteineryje be atsisiunciamu naršykliu: PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium
const testDataDir = process.env.E2E_DATA_DIR ?? '/tmp/fasiolas-e2e-data'

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://localhost:5173',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
      args: ['--no-sandbox'],
    },
  },
  webServer: [
    {
      command: 'npx tsx src/server.ts',
      cwd: '../server',
      url: 'http://localhost:3001/health',
      reuseExistingServer: true,
      env: {
        PORT: '3001',
        DATA_DIR: testDataDir,
        E2E_TEST_API: '1',
        BOT_ACTION_DELAY_MS: '50',
      },
    },
    {
      command: 'npx vite --port 5173 --host localhost',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
    },
  ],
})
