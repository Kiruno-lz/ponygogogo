import { defineConfig, devices } from '@playwright/test'

const PORT = 5177
export const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `bun run scripts/gen-manifest.ts && bunx vite --port ${PORT} --strictPort --host localhost`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
    cwd: '../..',
  },
})
