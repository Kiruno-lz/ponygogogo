/**
 * 注册前的取名窗口。通行密钥的用户名会留在系统的密钥列表里，是玩家**唯一**能用来
 * 区分同一站点下多个账户的东西，所以这一步不替玩家默认掉。
 * 点确认才唤起系统的通行密钥弹窗。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { WoodButton } from './Button.tsx'
import { t, type Lang } from './i18n.ts'

export function RegisterModal({ lang, defaultName, busy, onConfirm, onClose }: {
  lang: Lang
  defaultName: string
  busy: boolean
  onConfirm: (userName: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState(defaultName)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  const confirm = useCallback(() => {
    if (busy) return
    // 留空就回落到默认名，认证器列表里不留一个空条目
    onConfirm(name.trim() || defaultName)
  }, [busy, name, defaultName, onConfirm])

  return (
    <div className="wallet-modal-host" data-testid="register-modal" role="dialog" aria-modal="true"
      aria-label={t(lang, 'wallet.nameTitle')}>
      <div className="wallet-modal-scrim" onClick={() => !busy && onClose()} />
      {/* 只有一个输入框，回车即隐式提交 */}
      <form className="panel wallet-modal wallet-dialog" onSubmit={(e) => { e.preventDefault(); confirm() }}>
        <h2 className="h-title">{t(lang, 'wallet.nameTitle')}</h2>
        <p className="wallet-dialog-hint">{t(lang, 'wallet.nameHint')}</p>
        <label className="wallet-name-field">
          <span>{t(lang, 'wallet.nameLabel')}</span>
          <input
            ref={inputRef}
            type="text"
            className="mono"
            data-testid="register-name"
            value={name}
            maxLength={32}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="wallet-dialog-actions">
          <WoodButton zh={t(lang, busy ? 'home.registering' : 'wallet.nameConfirm')} onClick={confirm}
            disabled={busy} style={{ minWidth: 340 }} />
          <button type="button" className="chip" data-testid="register-cancel" disabled={busy} onClick={onClose}>
            {t(lang, 'wallet.cancel')}
          </button>
        </div>
      </form>
    </div>
  )
}
