import { defineConfig, devices } from '@playwright/test'
import { E2E_ENV } from './isolatedEnv.ts'

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 5177)
export const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  // 复用端口上已有的 Vite 时核对它的构建期变量，不是 E2E_ENV 就整轮失败
  globalSetup: './isolatedEnv.ts',
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // manifest.json 是提交进仓库的构建产物，跑测试不需要重新生成
    command: `node node_modules/vite/bin/vite.js --port ${PORT} --strictPort --host localhost`,
    // 构建期变量钉死，盖住仓库根 .env 里的真实测试网合约地址（见 isolatedEnv.ts）
    env: E2E_ENV,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
    cwd: '../..',
  },
})
