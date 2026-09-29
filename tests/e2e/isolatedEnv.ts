/**
 * E2E 的构建期变量全部钉死，不读仓库根 .env（那里是项目方指向真实测试网合约的配置）。
 * Vite 的 loadEnv 让进程环境里的 VITE_* 优先于 .env 文件，空字符串同样生效，所以逐项给值就能盖住。
 * - 合约地址置空：有奖入口停在「合约尚未部署」，任何用例都开不了真实会话；
 * - RPC、水龙头、Alchemy 指向 walletHarness 在路由层拦下的主机，Alchemy 密钥与策略是假的。
 * 有奖全链路只在本地 anvil 上测（specs/paid-race.spec.ts，另起 `vite --mode anvil`）。
 */
import type { FullConfig } from '@playwright/test'

export const E2E_ENV: Record<string, string> = {
  VITE_MONAD_RPC_URL: 'https://testnet-rpc.monad.xyz',
  VITE_FAUCET_URL: 'https://agents.devnads.com/v1/faucet',
  VITE_ALCHEMY_API_KEY: 'e2e-stub-key',
  VITE_ALCHEMY_POLICY_ID: '00000000-0000-4000-8000-000000000000',
  VITE_CANONICAL_HOST: 'ponygo.kiruno.cc',
  VITE_ENVIO_GRAPHQL_URL: '',
  VITE_PONY_VAULT_ADDRESS: '',
  VITE_PONY_GAME_ADDRESS: '',
  VITE_DEV_CHAIN: '',
  VITE_PAID_RACE_DEV: '',
}

/**
 * globalSetup：webServer 就绪之后、用例之前执行。`reuseExistingServer` 会复用端口上已有的 Vite，
 * 它若带着 .env 启动，有奖档的状态就随项目方配置漂移。这里读 Vite 注入模块的 import.meta.env，
 * 任何 VITE_* 与 E2E_ENV 不一致就整轮失败（只报变量名，不打印值）。
 */
export default async function assertIsolatedServer(config: FullConfig): Promise<void> {
  const base = config.webServer?.url ?? config.projects[0]?.use.baseURL
  const src = await (await fetch(new URL('/src/chain/network.ts', base))).text()
  const injected = /^import\.meta\.env = (\{.*?\});/.exec(src)?.[1]
  if (!injected) throw new Error(`${base} is not a Vite dev server: /src/chain/network.ts has no injected import.meta.env`)
  const served = JSON.parse(injected) as Record<string, unknown>
  const keys = new Set([...Object.keys(E2E_ENV), ...Object.keys(served).filter((k) => k.startsWith('VITE_'))])
  const drift = [...keys].filter((k) => served[k] !== E2E_ENV[k])
  if (drift.length > 0) {
    throw new Error(`the Vite server at ${base} was not started with the E2E env (differs: ${drift.join(', ')}); `
      + 'stop it and let Playwright start its own, or start it with the values in tests/e2e/isolatedEnv.ts')
  }
}
