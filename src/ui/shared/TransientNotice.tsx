import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react'

/** 临时通知：每条消息独立计时，点击外部关闭；翻译或重渲染不延长寿命。 */
export function TransientNotice({ children, noticeKey, onDismiss, className = 'panel transient-notice', testId = 'notice', role = 'status' }: {
  children: ReactNode
  noticeKey?: unknown
  onDismiss?: () => void
  className?: string
  testId?: string
  role?: 'status' | 'alert'
}) {
  const [visible, setVisible] = useState(true)
  const panel = useRef<HTMLDivElement>(null)
  const dismiss = useEffectEvent(() => { setVisible(false); onDismiss?.() })
  useEffect(() => {
    setVisible(true)
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target)) close()
    }
    const close = () => { dispose(); dismiss() }
    const timer = window.setTimeout(close, 5000)
    const dispose = () => { window.clearTimeout(timer); window.removeEventListener('pointerdown', outside) }
    window.addEventListener('pointerdown', outside)
    return dispose
  }, [noticeKey])
  return visible ? <div ref={panel} className={className} data-testid={testId} role={role}>{children}</div> : null
}
