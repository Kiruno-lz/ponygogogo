import { defineConfig, devices } from '@playwright/test'
import base from './playwright.config.ts'

export default defineConfig({ ...base,
  testMatch: ['specs/collectible*.spec.ts', 'specs/effect-showcase.spec.ts'],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
})
