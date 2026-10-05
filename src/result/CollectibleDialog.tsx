import { useEffect, useRef, useState } from 'react'
import type { CollectibleGrant } from '../chain/rewards.ts'
import { Card } from '../cards/Card.tsx'
import { StageDialog } from '../ui/StageDialog.tsx'
import { t, type Lang } from '../ui/i18n.ts'
import { collectibleView } from './collectibleView.ts'
import { CollectibleConfetti } from './CollectibleConfetti.tsx'
import { COLLECTIBLE_BREATH, COLLECTIBLE_BREATH_MS, COLLECTIBLE_SPIN, collectibleFaceFrames } from './collectibleMotion.ts'

export type CollectionSyncView = { loading: boolean; error: string | null; onRetry: () => void }

type Props = { grant: CollectibleGrant; lang: Lang; sync?: CollectionSyncView; reducedMotion?: boolean; onClose: () => void }

export function CollectibleDialog(props: Props) {
  return <CollectibleReveal key={`${props.grant.sessionId}:${props.grant.assetKind}:${props.grant.assetId}`} {...props}/>
}

function CollectibleReveal({ grant, lang, sync, reducedMotion = false, onClose }: Props) {
  const [phase, setPhase] = useState<'waiting' | 'spinning' | 'celebrating' | 'revealed'>('waiting')
  const [systemReduced, setSystemReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const panel = useRef<HTMLDivElement>(null)
  const rotation = useRef<HTMLDivElement>(null)
  const lift = useRef<HTMLDivElement>(null)
  const keep = useRef<HTMLButtonElement>(null)
  const reveal = useRef<HTMLButtonElement>(null)
  const front = useRef<HTMLDivElement>(null)
  const isReduced = reducedMotion || systemReduced
  const frontVisible = phase === 'celebrating' || phase === 'revealed'
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setSystemReduced(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    if (phase === 'waiting') { reveal.current?.focus(); return }
    if (phase === 'revealed') { keep.current?.focus(); return }
    if (isReduced) { setPhase('revealed'); return }
    const animation = phase === 'spinning'
      ? rotation.current!.animate([
        { transform: `rotateY(${COLLECTIBLE_SPIN.from}deg)` },
        { transform: `rotateY(${COLLECTIBLE_SPIN.to}deg)` },
      ], { duration: COLLECTIBLE_SPIN.duration, easing: COLLECTIBLE_SPIN.easing, fill: 'forwards' })
      : lift.current!.animate(COLLECTIBLE_BREATH, { duration: COLLECTIBLE_BREATH_MS, fill: 'forwards' })
    // Mask both faces on the same eased clock. WebKit can paint back-facing native/scrollable layers.
    const masks = phase === 'spinning' ? [
      front.current!.animate(collectibleFaceFrames(true), { duration: COLLECTIBLE_SPIN.duration, easing: COLLECTIBLE_SPIN.easing, fill: 'forwards' }),
      reveal.current!.animate(collectibleFaceFrames(false), { duration: COLLECTIBLE_SPIN.duration, easing: COLLECTIBLE_SPIN.easing, fill: 'forwards' }),
    ] : []
    for (const mask of masks) void mask.finished.catch(() => {})
    let cancelled = false
    animation.finished.then(() => {
      if (!cancelled) setPhase(phase === 'spinning' ? 'celebrating' : 'revealed')
    }).catch(() => { /* Unmount or a reduced-motion change cancels the in-flight reveal. */ })
    return () => { cancelled = true; animation.cancel(); masks.forEach(mask => mask.cancel()) }
  }, [phase, isReduced])
  const view = collectibleView(grant, lang)
  return <StageDialog label={view.title} testId="collectible-dialog" className="collectible-dialog" busy onDismiss={onClose}>
    {frontVisible && !isReduced && <CollectibleConfetti panel={panel}/>}
    <img src="/assets/art/collectibles/confetti.webp" alt="" hidden/>
    <div ref={panel} className="collectible-panel" tabIndex={-1} data-asset-kind={grant.assetKind} data-asset-id={grant.assetId}
      data-reveal-phase={phase} onKeyDown={event => { if ((phase === 'waiting' || phase === 'spinning') && event.key === 'Tab') event.preventDefault() }}>
      <div ref={lift} className="collectible-lift">
        <div ref={rotation} className="collectible-rotation" style={{ transform: `rotateY(${frontVisible ? 0 : 180}deg)` }}>
          <button ref={reveal} type="button" autoFocus className="collectible-face collectible-back" disabled={phase !== 'waiting'}
            style={{ visibility: frontVisible ? 'hidden' : 'visible' }}
            aria-hidden={phase !== 'waiting'} aria-label={t(lang, 'grant.reveal')}
            onClick={() => { panel.current?.focus(); setPhase(p => p === 'waiting' ? isReduced ? 'revealed' : 'spinning' : p) }}/>
          <div ref={front} lang={lang} className={`collectible-face collectible-front collectible-front-${view.card ? 'card' : 'pony'}`}
            style={{ visibility: frontVisible ? 'visible' : 'hidden' }}
            aria-hidden={!frontVisible} inert={!frontVisible}>
            <h2 className="collectible-title-sr">{t(lang, view.card ? 'grant.newCard' : 'grant.newPony')}</h2>
            <div className="collectible-art">{view.card ? <Card def={view.card} lang={lang} size="collectible"
              style={{ height: '100%', width: '100%' }}/>
              : <img src={`/assets/art/result/hero-${grant.assetId}.webp`} alt={view.name} draggable={false}/>}</div>
            <div className="collectible-caption">{!view.card && <h3>{view.name}</h3>}<p>{view.collected}</p></div>
            <button ref={keep} type="button" className="collectible-keep" onClick={onClose}>
              <img src="/assets/art/collectibles/keep-button.webp" alt="" draggable={false}/><span>{t(lang, 'grant.keep')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
    {frontVisible && sync && <div className="collectible-sync" aria-live="polite">
      {sync.loading && <p role="status">{t(lang, 'grant.syncing')}</p>}
      {sync.error && <div role="alert" className="collectible-sync-error"><p>{sync.error}</p>
        <button type="button" className="chip" disabled={sync.loading} onClick={sync.onRetry}>{t(lang, 'grant.retrySync')}</button></div>}
    </div>}
  </StageDialog>
}
