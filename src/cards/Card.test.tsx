import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CARD_BY_ID } from '../race/cards/pool.ts'
import { Card } from './Card.tsx'
import { CardChoicePanel } from './CardChoicePanel.tsx'
import { activateOnKey, onControl } from './cardKeys.ts'

const DEF = CARD_BY_ID['C-01']!

/** 开始标签：第一个 `<tag` 起到它的 `>` */
function openTag(html: string, marker: string): string {
  const at = html.indexOf(marker)
  expect(at).toBeGreaterThanOrEqual(0)
  const start = html.lastIndexOf('<', at)
  return html.slice(start, html.indexOf('>', at) + 1)
}

function key(k: string, repeat = false) {
  const calls: string[] = []
  return {
    calls,
    event: {
      key: k,
      repeat,
      preventDefault: () => calls.push('preventDefault'),
      stopPropagation: () => calls.push('stopPropagation'),
    },
  }
}

describe('Card as a button', () => {
  test('with onClick the root is a focusable button named after the card, described by its effect', () => {
    const html = renderToStaticMarkup(<Card def={DEF} lang="zh" onClick={() => undefined} />)
    const root = openTag(html, 'class="card-root"')
    expect(root).toContain(`data-card="${DEF.cardId}"`)
    expect(root).toContain(`data-quality="${DEF.quality}"`)
    expect(root).toContain('role="button"')
    expect(root).toContain('tabindex="0"')
    expect(root).toContain(`aria-label="${DEF.name.zh}"`)
    const describedBy = /aria-describedby="([^"]+)"/.exec(root)?.[1]
    expect(describedBy).toBeDefined()
    expect(openTag(html, `id="${describedBy}"`)).toStartWith('<p')
    expect(html).toContain(DEF.desc.zh)
  })

  test('without onClick it stays a plain, non-interactive element', () => {
    const root = openTag(renderToStaticMarkup(<Card def={DEF} lang="en" size="gallery" />), 'class="card-root"')
    for (const attr of ['role=', 'tabindex=', 'aria-label=', 'aria-describedby=']) expect(root).not.toContain(attr)
  })

  test('the compact hud face has no description to point at', () => {
    const root = openTag(renderToStaticMarkup(<Card def={DEF} lang="en" size="hud" onClick={() => undefined} />), 'class="card-root"')
    expect(root).toContain('role="button"')
    expect(root).not.toContain('aria-describedby=')
  })
})

describe('activateOnKey', () => {
  test('Enter and Space activate once and are consumed', () => {
    for (const k of ['Enter', ' ']) {
      let n = 0
      const { calls, event } = key(k)
      activateOnKey(event, () => n++)
      expect(n).toBe(1)
      expect(calls).toEqual(['preventDefault', 'stopPropagation'])
    }
  })

  test('auto-repeat is consumed without activating again', () => {
    let n = 0
    const { calls, event } = key('Enter', true)
    activateOnKey(event, () => n++)
    expect(n).toBe(0)
    expect(calls).toEqual(['preventDefault', 'stopPropagation'])
  })

  test('other keys pass through untouched to the global shortcuts', () => {
    for (const k of ['Escape', 'r', 'ArrowLeft', 'Tab']) {
      let n = 0
      const { calls, event } = key(k)
      activateOnKey(event, () => n++)
      expect(n).toBe(0)
      expect(calls).toEqual([])
    }
  })
})

describe('CardChoicePanel structure', () => {
  const base = {
    candidates: ['C-01', 'C-02', 'C-03'],
    checkpoint: 1,
    refreshCredits: 1,
    auto: false,
    timeLeftMs: 20_000,
    lang: 'en' as const,
    reducedMotion: true,
    onArmed: () => undefined,
    onPick: () => undefined,
    onSkip: () => undefined,
    onRefresh: () => undefined,
  }

  test('the slot wrapper is layout only; card and refresh are sibling controls', () => {
    const html = renderToStaticMarkup(<CardChoicePanel {...base} />)
    for (let i = 0; i < 3; i++) {
      const wrapper = openTag(html, `data-testid="card-choice-${i}"`)
      expect(wrapper).not.toContain('role=')
      expect(wrapper).not.toContain('tabindex=')
      expect(html).toContain(`data-testid="card-refresh-${i}"`)
    }
    expect(html.match(/class="card-root"[^>]*role="button"/g)?.length).toBe(3)
  })

  test('auto and locked panels render the cards as plain faces outside the tab order', () => {
    for (const props of [{ auto: true }, { locked: true }]) {
      const html = renderToStaticMarkup(<CardChoicePanel {...base} {...props} />)
      expect(html).not.toContain('role="button"')
      expect(html).not.toContain('tabindex=')
      for (let i = 0; i < 3; i++) {
        expect(openTag(html, `data-testid="card-refresh-${i}"`)).toContain('disabled=""')
      }
    }
  })

  test('refresh controls stay present without credits and enable when credits are available', () => {
    for (const refreshCredits of [0, 1]) {
      const html = renderToStaticMarkup(<CardChoicePanel {...base} refreshCredits={refreshCredits} />)
      for (let i = 0; i < 3; i++) {
        const button = openTag(html, `data-testid="card-refresh-${i}"`)
        expect(button).toStartWith('<button')
        expect(button.includes('disabled=""')).toBe(refreshCredits === 0)
      }
    }
  })
})

describe('onControl', () => {
  const at = (hit: boolean) => ({ closest: (sel: string) => (sel === 'button, [role="button"]' && hit ? {} : null) })

  test('a key on a button or a card button belongs to that control', () => {
    expect(onControl(at(true) as unknown as EventTarget)).toBe(true)
  })

  test('a key on the page, or on a target without closest, is for the global shortcut', () => {
    expect(onControl(at(false) as unknown as EventTarget)).toBe(false)
    expect(onControl(null)).toBe(false)
    expect(onControl({} as EventTarget)).toBe(false)
  })
})
