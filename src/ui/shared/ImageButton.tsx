import type { ReactNode } from 'react'
import { usePress } from './Button.tsx'

/** Transparent artwork, accessible activation and press feedback shared by home/result buttons. */
export function ImageButton({ src, label, children, className, testId, disabled, onClick }: {
  src: string; label: string; children?: ReactNode; className: string; testId?: string
  disabled?: boolean; onClick: () => void
}) {
  const { pressed, handlers } = usePress(onClick, disabled)
  return <button type="button" aria-label={label} data-testid={testId}
    className={`btn ${className}${pressed ? ' pressed' : ''}`} disabled={disabled} {...handlers}>
    <img src={src} alt="" draggable={false}/>
    {children ?? <span className="lbl">{label}</span>}
  </button>
}
