import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Address } from 'viem'
import { PaidResumeModal } from './PaidResumeModal.tsx'
import { RegisterModal } from './RegisterModal.tsx'
import { openModal, type KeySource, type ModalHost } from './modalHost.ts'
import { StageDialog } from './StageDialog.tsx'
import { WalletModal } from './WalletModal.tsx'
import { t } from './i18n.ts'

const noop = () => undefined

/** 事件目标的假对象：按类型记监听，fire 同步派发 */
function target() {
  const listeners = new Map<string, Set<(e: never) => void>>()
  return {
    addEventListener: (type: string, l: (e: never) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(l)
    },
    removeEventListener: (type: string, l: (e: never) => void) => listeners.get(type)?.delete(l),
    fire: (type: string, e: object = {}) => listeners.get(type)?.forEach((l) => l(e as never)),
    size: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
  }
}

/** 假 dialog：showModal / close 与浏览器一样翻转 open；close 事件由测试自己派发（浏览器里是排队的任务） */
function fakeDialog(log: string[]) {
  const dialog = {
    ...target(),
    open: false,
    showModal: () => {
      dialog.open = true
      log.push('showModal')
    },
    close: () => {
      dialog.open = false
      log.push('close')
    },
  }
  return dialog
}

function rig(opts: { busy?: boolean; connected?: boolean } = {}) {
  const log: string[] = []
  const dialog = fakeDialog(log)
  const keys = target()
  const opener = { isConnected: opts.connected ?? true, focus: () => log.push('focus-opener') }
  let busy = opts.busy ?? false
  const dismiss = () => {
    log.push(busy ? 'dismiss-refused' : 'dismiss')
    return !busy
  }
  const reopen = () => openModal(dialog as unknown as ModalHost, keys as unknown as KeySource, opener, dismiss)
  const close = reopen()
  const escape = (extra: object = {}) => {
    const e = { key: 'Escape', isComposing: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true }, ...extra }
    keys.fire('keydown', e)
    return e
  }
  return { log, dialog, keys, close, reopen, escape, setBusy: (b: boolean) => { busy = b } }
}

/** 根元素的开始标签 */
function rootTag(html: string): string {
  return html.slice(0, html.indexOf('>') + 1)
}

describe('StageDialog', () => {
  test('renders a closed native dialog; only showModal() opens it', () => {
    const html = renderToStaticMarkup(
      <StageDialog label="Title" testId="x-modal" onDismiss={noop}><p>body</p></StageDialog>,
    )
    const root = rootTag(html)
    expect(root).toStartWith('<dialog')
    expect(root).toContain('class="stage-dialog"')
    expect(root).toContain('data-testid="x-modal"')
    expect(root).toContain('aria-label="Title"')
    // 带 open 属性渲染的话，showModal() 会抛 InvalidStateError，且窗口不是模态
    expect(root).not.toContain('open')
    expect(html).toContain('<p>body</p>')
  })
})

describe('openModal', () => {
  test('opens modally; Escape is taken from the browser and becomes a dismiss request', () => {
    const r = rig()
    expect(r.log).toEqual(['showModal'])
    expect(r.escape().defaultPrevented).toBe(true)
    expect(r.log).toEqual(['showModal', 'dismiss'])
    r.close()
  })

  test('busy: Escape is still swallowed, so the browser cannot close the dialog behind React', () => {
    const r = rig({ busy: true })
    expect(r.escape().defaultPrevented).toBe(true)
    expect(r.log).toEqual(['showModal', 'dismiss-refused'])
    r.close()
  })

  test('other keys and Escape during IME composition are left alone', () => {
    const r = rig()
    expect(r.escape({ isComposing: true }).defaultPrevented).toBe(false)
    expect(r.escape({ key: 'Enter' }).defaultPrevented).toBe(false)
    expect(r.log).toEqual(['showModal'])
    r.close()
  })

  test('stacked dialogs: only the top one answers Escape, the one below takes over once it closes', () => {
    const below = rig()
    const top = rig()
    top.escape()
    expect(top.log).toEqual(['showModal', 'dismiss'])
    expect(below.log).toEqual(['showModal'])
    top.close()
    below.escape()
    expect(below.log).toEqual(['showModal', 'dismiss'])
    below.close()
  })

  test('a scrim click needs both press and release on the dialog itself', () => {
    const r = rig()
    const panel = {}
    r.dialog.fire('pointerdown', { target: panel })
    r.dialog.fire('click', { target: r.dialog })
    r.dialog.fire('pointerdown', { target: r.dialog })
    r.dialog.fire('click', { target: panel })
    expect(r.log).toEqual(['showModal'])
    r.dialog.fire('pointerdown', { target: r.dialog })
    r.dialog.fire('click', { target: r.dialog })
    expect(r.log).toEqual(['showModal', 'dismiss'])
    r.close()
  })

  test('other close requests are cancelled and routed through dismiss', () => {
    const r = rig()
    let prevented = false
    r.dialog.fire('cancel', { preventDefault: () => { prevented = true } })
    expect(prevented).toBe(true)
    expect(r.log).toEqual(['showModal', 'dismiss'])
    r.close()
  })

  test('a forced native close reopens while busy and otherwise hands the close to the parent', () => {
    const r = rig({ busy: true })
    // 浏览器自己关了窗：open 已经是 false，再派发 close
    r.dialog.open = false
    r.dialog.fire('close')
    expect(r.log).toEqual(['showModal', 'dismiss-refused', 'showModal'])
    expect(r.dialog.open).toBe(true)
    r.setBusy(false)
    r.dialog.open = false
    r.dialog.fire('close')
    expect(r.log).toEqual(['showModal', 'dismiss-refused', 'showModal', 'dismiss'])
    r.close()
  })

  test('a close event that arrives after the dialog is open again is stale and ignored', () => {
    const r = rig()
    r.dialog.fire('close')
    expect(r.log).toEqual(['showModal'])
    r.close()
  })

  test('StrictMode remount: the close queued by the first cleanup does not dismiss the reopened dialog', () => {
    // 开发模式下 React 对同一个 <dialog> 跑 mount → cleanup → mount；cleanup 的 close() 排了一个 close 事件，
    // 它在第二次 mount 重新挂上监听之后才派发（tests/e2e/regressions/REPRO.md 第四节）
    const r = rig()
    r.close()
    const closeAgain = r.reopen()
    r.dialog.fire('close')
    expect(r.log).toEqual(['showModal', 'close', 'focus-opener', 'showModal'])
    expect(r.dialog.open).toBe(true)
    closeAgain()
  })

  test('closing detaches every listener before close(), then returns focus to a still-mounted opener', () => {
    const r = rig()
    r.close()
    expect(r.dialog.size()).toBe(0)
    expect(r.keys.size()).toBe(0)
    expect(r.log).toEqual(['showModal', 'close', 'focus-opener'])
    r.dialog.fire('close')
    r.escape()
    expect(r.log).toEqual(['showModal', 'close', 'focus-opener'])
  })

  test('an opener that is gone is not focused', () => {
    const r = rig({ connected: false })
    r.close()
    expect(r.log).toEqual(['showModal', 'close'])
  })
})

describe('modals sit on StageDialog', () => {
  const account = { address: '0x3333333333333333333333333333333333333333' as Address, label: '0x3333…3333' }
  const cases = [
    {
      testId: 'paid-resume',
      label: t('en', 'resume.title'),
      html: renderToStaticMarkup(
        <PaidResumeModal lang="en" stakeLabel="0.3" deadline={{ state: 'lost' }} busy={false} canSettle
          onContinue={noop} onSettle={noop} onLater={noop} />,
      ),
    },
    {
      testId: 'register-modal',
      label: t('en', 'wallet.nameTitle'),
      html: renderToStaticMarkup(
        <RegisterModal lang="en" defaultName="Pony" busy={false} onConfirm={noop} onClose={noop} />,
      ),
    },
    {
      testId: 'wallet-modal',
      label: t('en', 'wallet.title'),
      html: renderToStaticMarkup(
        <WalletModal lang="en" account={account} gameAccount={null} gameError={null} funds={null}
          rootBalance={null} tx={{ phase: 'idle' }}
          onRefresh={async () => undefined} onFaucet={async () => ({ ok: true, detail: '' })} onExport={async () => ''}
          onDeposit={async () => undefined} onWithdraw={async () => undefined} onMigrate={async () => null}
          onClose={noop} />,
      ),
    },
  ]

  for (const c of cases) {
    test(`${c.testId}: a native dialog named by its title, no hand-rolled scrim`, () => {
      const root = rootTag(c.html)
      expect(root).toStartWith('<dialog')
      expect(root).toContain(`data-testid="${c.testId}"`)
      expect(root).toContain(`aria-label="${c.label}"`)
      expect(c.html).not.toContain('wallet-modal-scrim')
      expect(c.html).not.toContain('role="dialog"')
      expect(c.html).not.toContain('aria-modal')
    })
  }
})
