/**
 * 舞台上的模态窗口。原生 <dialog> 经 showModal() 打开：焦点困在窗口里，背景惰性，读屏只读窗口。
 * 开关只由父组件的 state 决定：挂载即打开，卸载即关闭，关闭后焦点回到打开它的控件。
 * 关闭请求（Escape、点遮罩、系统返回手势）统一交给 onDismiss，busy 时一律不关。
 *
 * showModal() 把窗口放进顶层（top layer），脱离了 .stage 的 scale 变换，所以窗口按 .stage 发布的
 * --stage-* 变量贴回舞台的位置与缩放（theme.css 的 .stage-dialog），外观与留在舞台内时一致；
 * 遮罩画在窗口自身，舞台外的黑边与原来一样不变暗。
 */
import { useEffectEvent, useLayoutEffect, useRef, type ReactNode } from 'react'
import { openModal } from './modalHost.ts'

export function StageDialog({ label, testId, busy = false, onDismiss, children }: {
  /** 可访问名：窗口标题 */
  label: string
  testId: string
  /** 进行中：Escape、点遮罩、返回手势都不关闭 */
  busy?: boolean
  onDismiss: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement | null>(null)
  const dismiss = useEffectEvent((): boolean => {
    if (busy) return false
    onDismiss()
    return true
  })

  useLayoutEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return openModal(dialog, window, opener, () => dismiss())
  }, [])

  return (
    <dialog ref={ref} className="stage-dialog" data-testid={testId} aria-label={label}>
      {children}
    </dialog>
  )
}
