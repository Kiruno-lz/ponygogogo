import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { copyPoster, downloadBlob, drawPoster, platformUrl, posterContent } from '../export/poster.ts'
import type { RaceResult } from '../race/core/types.ts'
import { StageDialog } from '../ui/StageDialog.tsx'
import { t, type Lang } from '../ui/i18n.ts'
import type { PaidResultView } from './ResultScreen.tsx'

type IconName = 'copy' | 'save' | 'x' | 'instagram' | 'xiaohongshu' | 'close'
export function SharePosterDialog({ lang, result, paid, onClose }: {
  lang: Lang; result: RaceResult; paid?: PaidResultView; onClose: () => void
}) {
  const content = useMemo(() => posterContent(result, paid, lang), [result, paid, lang])
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null)
  const [feedback, setFeedback] = useState('')
  const [failed, setFailed] = useState(false)
  const [copying, setCopying] = useState(false)
  useEffect(() => {
    let active = true
    let url: string | undefined
    setImage(null); setFailed(false); setFeedback('')
    void drawPoster(content).then(blob => {
      if (!active) return
      url = URL.createObjectURL(blob)
      setImage({ blob, url })
    }).catch(() => {
      if (active) setFailed(true)
    })
    return () => { active = false; if (url) URL.revokeObjectURL(url) }
  }, [content])

  function copy() {
    if (!image || copying) return
    setCopying(true)
    void copyPoster(image.blob).then(() => setFeedback(t(lang, 'share.copied')))
      .catch(() => setFeedback(t(lang, 'share.copyFailed'))).finally(() => setCopying(false))
  }
  function jump(platform: 'x' | 'instagram' | 'xiaohongshu') {
    if (!image) return
    // Open synchronously from the user's click. These sites accept manual image attachments.
    window.open(platformUrl(platform, `Ponygogogo #${content.rank} · ${content.amount}`), '_blank', 'noopener,noreferrer')
    setFeedback(t(lang, 'share.attachImage'))
  }
  function button(icon: IconName, label: string, onClick: () => void, disabled = false) {
    return <button type="button" className="share-icon-button" data-testid={`share-${icon}`} aria-label={label} title={label} onClick={onClick} disabled={disabled}><ShareIcon name={icon} /></button>
  }
  return (
    <StageDialog label={t(lang, 'result.share')} testId="share-dialog" className="share-dialog" onDismiss={onClose}>
      <div className="share-poster-panel" aria-busy={!image && !failed}>
        {image ? <img data-testid="share-poster" className="share-poster-image" src={image.url} alt={`Ponygogogo · ${content.name} · #${content.rank} · ${content.amount} · ${content.status}${content.grant ? ` · ${content.grant.kind}: ${content.grant.name}` : ''}`} />
          : <div className="share-placeholder" role="status">{t(lang, failed ? 'share.failed' : 'share.loading')}</div>}
        <div className="share-close">{button('close', t(lang, 'share.close'), onClose)}</div>
        <div className="share-actions">
          {button('copy', t(lang, 'share.copy'), copy, !image || copying)}
          {button('save', t(lang, 'share.save'), () => { if (image) { downloadBlob(image.blob); setFeedback(t(lang, 'share.saved')) } }, !image)}
          {button('x', t(lang, 'share.x'), () => jump('x'), !image)}
          {button('instagram', t(lang, 'share.instagram'), () => jump('instagram'), !image)}
          {button('xiaohongshu', t(lang, 'share.xiaohongshu'), () => jump('xiaohongshu'), !image)}
        </div>
        <span className="share-feedback" data-testid="share-feedback" role="status">{feedback}</span>
      </div>
    </StageDialog>
  )
}

function ShareIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    close: <path d="m6 6 12 12M18 6 6 18" />,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
    save: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></>,
    x: <path d="m4 3 12 18h4L8 3H4Zm0 18L20 3" />,
    instagram: <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r=".7" fill="currentColor" /></>,
    xiaohongshu: <><path d="m3 6-2 5h4l-3 5h4M1 20h5M9 7h5m-3-3v14m-4 2h8M17 5h5v15h-5V5Zm0 5h5m-3-5v15" /></>,
  }
  return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
