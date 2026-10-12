import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = new URL('../..', import.meta.url).pathname
const configured = {
  VITE_ALCHEMY_API_KEY: 'public-browser-test-key',
  VITE_ALCHEMY_POLICY_ID: 'test-policy',
  VITE_PONY_GAME_ADDRESS: '0x0000000000000000000000000000000000000001',
  VITE_PONY_VAULT_ADDRESS: '0x0000000000000000000000000000000000000002',
  VITE_ENVIO_GRAPHQL_URL: 'https://example.com/v1/graphql',
}
function config(command: 'build' | 'serve', values: Record<string, string>, envFile = '') {
  const cwd = mkdtempSync(join(tmpdir(), 'pony-build-config-'))
  try {
    if (envFile) writeFileSync(join(cwd, '.env'), envFile)
    return spawnSync('node', ['--input-type=module', '-e',
      `import {resolveConfig} from ${JSON.stringify(join(root, 'node_modules/vite/dist/node/index.js'))}; await resolveConfig({configFile:${JSON.stringify(join(root, 'vite.config.ts'))}},${JSON.stringify(command)});`], {
      cwd, env: { PATH: process.env.PATH, HOME: process.env.HOME, ...values }, encoding: 'utf8',
    })
  } finally { rmSync(cwd, { recursive: true, force: true }) }
}

test('a clean Git build fails before publishing an unconfigured wallet', () => {
  const result = config('build', {})
  expect(result.status).not.toBe(0)
  for (const key of Object.keys(configured)) expect(result.stderr).toContain(key)
})

for (const missing of Object.keys(configured)) test(`production build rejects missing ${missing} without printing values`, () => {
  const result = config('build', { ...configured, [missing]: '' })
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain(missing)
  expect(result.stderr).not.toContain(configured.VITE_ALCHEMY_API_KEY)
})

test('build variables and local Vite env files both configure production builds', () => {
  expect(config('build', configured).status).toBe(0)
  expect(config('build', {}, Object.entries(configured).map(([key, value]) => `${key}=${value}`).join('\n')).status).toBe(0)
})

test('an explicitly empty cloud variable overrides the local env file', () => {
  const result = config('build', { VITE_ALCHEMY_API_KEY: '' }, Object.entries(configured).map(([key, value]) => `${key}=${value}`).join('\n'))
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('VITE_ALCHEMY_API_KEY')
})

test('local development remains available without deployment configuration', () => {
  expect(config('serve', {}).status).toBe(0)
})
