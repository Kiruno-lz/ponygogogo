import { useCallback, useRef, useState, type ReactNode } from 'react'
import { uiClick, uiHover } from './sfx.ts'

interface Base {
  onClick?: () => void
  disabled?: boolean
  className?: string
  children?: ReactNode
  ariaLabel?: string
}

/** 所有按钮必须覆盖鼠标、触控和键盘触发路径，且按下即有缩放反馈 */
export function usePress(onClick?: () => void, disabled?: boolean) {
  const [pressed, setPressed] = useState(false)
  const armed = useRef(false)
  const down = useCallback(() => {
    if (disabled) return
    armed.current = true
    setPressed(true)
    uiClick()
  }, [disabled])
  const up = useCallback(() => {
    setPressed(false)
    if (!armed.current || disabled) return
    armed.current = false
    onClick?.()
  }, [onClick, disabled])
  const cancel = useCallback(() => {
    armed.current = false
    setPressed(false)
  }, [])
  return {
    pressed,
    handlers: {
      onPointerDown: down,
      onPointerUp: up,
      onPointerEnter: () => {
        if (!disabled) uiHover()
      },
      onPointerLeave: cancel,
      onPointerCancel: cancel,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          down()
        }
      },
      onKeyUp: (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          up()
        }
      },
    },
  }
}

export function WoodButton({
  zh,
  en,
  icon,
  onClick,
  disabled,
  style,
  variant = 1,
}: Base & {
  zh: string
  en?: string
  icon?: ReactNode
  style?: React.CSSProperties
  /** 三块木牌各自的造型（对应 assrt/tittle.png 的三个按钮），默认第一块 */
  variant?: 1 | 2 | 3
}) {
  const { pressed, handlers } = usePress(onClick, disabled)
  return (
    <button
      type="button"
      className={`btn btn-wood btn-wood-${variant}${pressed ? ' pressed' : ''}`}
      disabled={disabled}
      style={style}
      {...handlers}
    >
      {icon ? <span className="ico">{icon}</span> : null}
      <span className="lbl">
        <span className="zh">{zh}</span>
        {en ? <span className="en">{en}</span> : null}
      </span>
    </button>
  )
}

export function StarButton({
  big,
  sub,
  onClick,
  disabled,
  style,
}: Base & { big: string; sub?: string; style?: React.CSSProperties }) {
  const { pressed, handlers } = usePress(onClick, disabled)
  return (
    <button
      type="button"
      className={`btn btn-star${pressed ? ' pressed' : ''}`}
      disabled={disabled}
      style={style}
      {...handlers}
    >
      <span className="big h-title">{big}</span>
      {sub ? <span className="sub">{sub}</span> : null}
    </button>
  )
}

export function Chip({
  label,
  on,
  onClick,
  disabled,
  style,
}: Base & { label: ReactNode; on?: boolean; style?: React.CSSProperties }) {
  const { pressed, handlers } = usePress(onClick, disabled)
  return (
    <button
      type="button"
      className={`chip${on ? ' on' : ''}${pressed ? ' pressed' : ''}`}
      disabled={disabled}
      style={style}
      {...handlers}
    >
      {label}
    </button>
  )
}
