/**
 * 模态窗口的开关逻辑（StageDialog 的底层）：showModal、叠放顺序、全部关闭请求与焦点归还。
 * 与组件分开放，组件文件只导出组件（快速刷新要求）；L1 用假对象驱动同一套逻辑（StageDialog.test.tsx）。
 */
/** openModal 用到的窗口与 window 的最小接口：L1 用假对象驱动同一套开关逻辑 */
export type ModalHost = EventTarget & Pick<HTMLDialogElement, 'showModal' | 'close' | 'open'> & Partial<Pick<HTMLDialogElement, 'querySelectorAll'>>
export type KeySource = Pick<Window, 'addEventListener' | 'removeEventListener'>

/** 同时开着的窗口按打开顺序叠放，只有最上面那个响应 Escape */
const openStack: ModalHost[] = []

/**
 * 以模态打开 dialog 并接上全部关闭请求，返回关闭函数。
 * dismiss 返回是否真的交给了父组件去关（busy 时返回 false，窗口留着）。
 */
export function openModal(
  dialog: ModalHost,
  keys: KeySource,
  opener: { readonly isConnected: boolean; focus(): void } | null,
  dismiss: () => boolean,
): () => void {
  dialog.showModal()
  openStack.push(dialog)

  // Escape 在 window 上接：进行中按钮变成 disabled 时焦点会掉到 body，不在窗口里。
  // 拦下默认动作，浏览器就不会自己关窗；输入法组字时的 Escape 只是取消组字
  const onKey = (e: KeyboardEvent): void => {
    if (e.isComposing || openStack.at(-1) !== dialog) return
    // Native dialogs may move focus into browser chrome after the last control. Keep Tab within the modal.
    if (e.key === 'Tab' && dialog.querySelectorAll) {
      const controls = [...dialog.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]')]
        .filter(el => el.tabIndex >= 0 && !el.hasAttribute('disabled') && el.getClientRects().length > 0)
      const first = controls[0], last = controls.at(-1)
      const focused = first?.ownerDocument.activeElement
      if (first && last && (!controls.some(el => el === focused) || (e.shiftKey ? focused === first : focused === last))) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      }
      return
    }
    if (e.key !== 'Escape') return
    e.preventDefault()
    dismiss()
  }
  // 窗口铺满舞台、面板居中，按在窗口自身上就是按在遮罩上（舞台外的 ::backdrop 也算窗口）。
  // 按下与松开都要在遮罩上：在输入框里拖选文字拖到外面松手，不算点遮罩
  let downOnScrim = false
  const onPointerDown = (e: Event): void => {
    downOnScrim = e.target === dialog
  }
  const onClick = (e: Event): void => {
    if (downOnScrim && e.target === dialog) dismiss()
    downOnScrim = false
  }
  // Escape 以外的关闭请求（安卓返回手势等）
  const onCancel = (e: Event): void => {
    e.preventDefault()
    dismiss()
  }
  // 连续的关闭请求之间没有用户激活时 cancel 不可取消，浏览器会强行关窗：进行中就重新打开。
  // close 事件是排队派发的：到达时窗口若已重新打开（开发模式 StrictMode 的 cleanup → 再 mount，
  // 或上面这次重开），它就是过期的，不算关闭请求
  const onClose = (): void => {
    if (dialog.open) return
    if (!dismiss()) dialog.showModal()
  }

  keys.addEventListener('keydown', onKey)
  dialog.addEventListener('pointerdown', onPointerDown)
  dialog.addEventListener('click', onClick)
  dialog.addEventListener('cancel', onCancel)
  dialog.addEventListener('close', onClose)
  return () => {
    // 先摘监听再关：自己发起的关闭不能再被当成一次关闭请求
    keys.removeEventListener('keydown', onKey)
    dialog.removeEventListener('pointerdown', onPointerDown)
    dialog.removeEventListener('click', onClick)
    dialog.removeEventListener('cancel', onCancel)
    dialog.removeEventListener('close', onClose)
    const at = openStack.indexOf(dialog)
    if (at >= 0) openStack.splice(at, 1)
    dialog.close()
    if (opener?.isConnected) opener.focus()
  }
}
