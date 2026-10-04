import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { existsSync } from 'node:fs'
import { encodeResult, decodeResult } from '../chain/codec.ts'
import { posterContent } from '../export/poster.ts'
import { HorseAvatar, Hud } from '../ui/Hud.tsx'
import { PONY_CATALOG } from '../game/ponyCatalog.ts'
import { RaceDriver } from './driver.ts'
import { derivePaidCoreInput, solvePaidRace } from './paid/race.ts'
import { FIXTURE_ANCHOR, FIXTURE_SEED } from './paid/testkit.ts'
import { idlePaidState } from './paidSnapshot.ts'

const roster = [4, 2, 0, 1, 3] as const
const input = { seed: FIXTURE_SEED, openAnchor: FIXTURE_ANCHOR, stakeTier: 1 as const,
  playerHorseId: 0, choices: [null, null, null] as const, roster }

test('排行榜为所有九个角色提供真实头像资源', () => {
  for (const pony of PONY_CATALOG) {
    const html = renderToStaticMarkup(<HorseAvatar horseId={pony.ponyId} size={50}/>)
    const path = /<img src="([^"]+)"/.exec(html)![1]!
    expect(existsSync(new URL(`../../public${path}`, import.meta.url)), path).toBe(true)
  }
})

test('explicit roster survives derivation, solving, practice snapshots and result', () => {
  expect(derivePaidCoreInput(input)).toHaveProperty('roster', roster)
  expect(solvePaidRace(input, { trace: false })).toHaveProperty('roster', roster)
  const driver = new RaceDriver({ seed: FIXTURE_SEED, playerHorseId: 0, stakeTier: 0, roster }, { countdownMs: 0, tailSpeed: 6 })
  expect(driver.state).toHaveProperty('roster', roster)
  driver.update(0)
  driver.update(250)
  expect(driver.state).toHaveProperty('roster', roster)
  expect(driver.state.horses.map(h => h.laneIndex)).toEqual([0, 1, 2, 3, 4])
  expect(driver.buildResult('roster-practice')).toHaveProperty('roster', roster)
})

test('invalid rosters are rejected before entering the solver', () => {
  for (const bad of [[0, 1, 2, 3], [0, 1, 2, 3, 4, 5], [0, 0, 2, 3, 4], [0, 1, 2, 3, 9], [0, 1, 2, 3, -1], [0, 1, 2, 3, 0.5]]) {
    expect(() => derivePaidCoreInput({ ...input, roster: bad })).toThrow('INVALID_ROSTER')
  }
})

test('HUD and poster use the role at the participant slot instead of treating slot as pony id', () => {
  const state = idlePaidState(0, 0, roster)
  const html = renderToStaticMarkup(<Hud state={state} lang="zh" reducedMotion={false}
    gogoPunchKey={0} onGogoDown={() => {}} onGogoUp={() => {}} hideGogo={false} />)
  const first = html.slice(html.indexOf('data-testid="board-row-0"'), html.indexOf('data-testid="board-row-1"'))
  expect(first).toContain('Thunder')
  expect(first).toContain('leaderboard-avatar-4.webp')
  const driver = new RaceDriver({ seed: FIXTURE_SEED, playerHorseId: 0, stakeTier: 0, roster })
  expect(posterContent(driver.buildResult('roster-poster'), undefined, 'zh')).toMatchObject({ ponyId: 4, name: 'Thunder' })
})

test('offline result encoding preserves the roster and still decodes old v1 records', () => {
  const driver = new RaceDriver({ seed: FIXTURE_SEED, playerHorseId: 0, stakeTier: 0, roster })
  const result = driver.buildResult('roster-codec')
  expect(decodeResult(encodeResult(result))).toEqual(result)
  expect(encodeResult(result)).toStartWith('v2|')
  const old = decodeResult('v1|old|0x12|3|2|123|||f')
  expect(old.horseId).toBe(3)
  expect(old.roster ?? [0, 1, 2, 3, 4]).toEqual([0, 1, 2, 3, 4])
})

test('all initial-five lane permutations run a complete practice race and preserve the chosen role through sharing', () => {
  function permutations(ids: number[]): number[][] {
    return ids.length ? ids.flatMap((id, i) => permutations(ids.filter((_, j) => j !== i)).map(rest => [id, ...rest])) : [[]]
  }
  for (const roster of permutations([0, 1, 2, 3, 4])) {
    const driver = new RaceDriver({ seed: FIXTURE_SEED, playerHorseId: 0, stakeTier: 0, roster }, { countdownMs: 0, tailSpeed: 6 })
    let now = 0
    driver.update(now)
    for (let step = 0; driver.phase !== 'done' && step < 4000; step++) driver.update(now += 250)
    expect(driver.phase).toBe('done')
    expect(driver.state.horses).toHaveLength(5)
    expect([...driver.canonicalResult().rawOrder].sort()).toEqual([0, 1, 2, 3, 4])
    const result = driver.buildResult('permutation')
    expect(result.roster).toEqual(roster)
    expect(posterContent(result, undefined, 'zh').ponyId).toBe(roster[0])
    expect(decodeResult(encodeResult(result)).roster).toEqual(roster)
  }
})
