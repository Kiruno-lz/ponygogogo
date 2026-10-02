import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = new URL('../..', import.meta.url).pathname
const script = readFileSync(join(root, 'scripts/deploy.sh'), 'utf8')
// Execute the real asset-coverage preflight alone; the migration and deployment stages never run.
const preflight = script.slice(script.indexOf('# ---- 5b.'), script.indexOf('# ---- 6.'))
const headers = readFileSync(join(root, 'public/_headers'), 'utf8')

function coverage(path: string) {
  const dist = mkdtempSync(join(tmpdir(), 'pony-card-assets-'))
  try {
    writeFileSync(join(dist, '_headers'), headers)
    mkdirSync(join(dist, path, '..'), { recursive: true })
    writeFileSync(join(dist, path), '<svg/>')
    return spawnSync('bash', ['-c', 'say() { :; }; die() { echo "$*"; exit 1; };\n' + preflight], {
      env: { ...process.env, DIST_DIR: dist }, encoding: 'utf8',
    })
  } finally { rmSync(dist, { recursive: true, force: true }) }
}

test('new card icons pass the actual deployment asset-coverage preflight and have a cache policy', () => {
  const result = coverage('assets/cards/card-22.svg')
  expect(result.status).toBe(0)
  const policy = headers.split('\n\n').find(block => block.includes('/assets/cards/*'))
  expect(policy).toContain('Cache-Control: public, max-age=86400, stale-while-revalidate=604800')
})

test('asset coverage still rejects an unconfigured directory', () => {
  const result = coverage('assets/unconfigured/unknown.svg')
  expect(result.status).toBe(1)
  expect(result.stdout).toContain('assets/unconfigured/unknown.svg')
})
