import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { idlePaidState } from '../race/paidSnapshot.ts'
import { Hud } from './Hud.tsx'

test('免费和有奖状态的 gogo 都只显示 GOGOGO，卡牌能力不改写它', () => {
  for (const stakeTier of [0, 2]) for (const abilityId of [null, 'clapSwap', 'wheelHold'] as const) {
    const state = idlePaidState(0, stakeTier)
    if (abilityId) state.abilityBinding = { abilityId, instanceId: 1, ownerHorseId: 0 }
    const html = renderToStaticMarkup(<Hud state={state} lang="zh" reducedMotion={false}
      gogoPunchKey={0} onGogoDown={() => {}} onGogoUp={() => {}} hideGogo={false} />)
    const start = html.lastIndexOf('<button', html.indexOf('data-testid="gogo"'))
    const button = html.slice(start, html.indexOf('</button>', start))
    expect(button).toContain('>GOGOGO</span>')
    expect(button).not.toContain('class="sub"')
    expect(button).not.toMatch(/免费试玩|有奖|MON|CLAP|HOLD/)
  }
})

test('免费和有奖状态力竭时 gogo 仍可用，保留力竭提示和体力视觉', () => {
  for (const stakeTier of [0, 2]) {
    const state = idlePaidState(0, stakeTier)
    state.horses[0]!.stamina = 0
    state.effects.push({
      instanceId: 200_000, sourceCardId: 'system.exhaust', primitive: 'Status', moduleId: 'paid',
      ownerHorseId: 0, appliedAtTick: 0, durationTicks: null, tags: ['debuff'],
      payload: { statusId: 'exhausted' },
    })
    const html = renderToStaticMarkup(<Hud state={state} lang="zh" reducedMotion={false}
      gogoPunchKey={0} onGogoDown={() => {}} onGogoUp={() => {}} hideGogo={false} />)
    const start = html.lastIndexOf('<button', html.indexOf('data-testid="gogo"'))
    expect(start).toBeGreaterThanOrEqual(0)
    const button = html.slice(start, html.indexOf('</button>', start))
    expect(button).not.toMatch(/\sdisabled(?:\s|=|>)/)
    expect(html).toContain('data-testid="exhausted"')
    expect(html).toContain('stamina-art exhausted-art')
  }
})
