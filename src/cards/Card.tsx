import { cardIconUrl } from '../race/cards/iconUrl.ts'
/**
 * 卡面只有一套实现。选牌时的候选牌、HUD 上生效中的牌、结算页回顾的牌
 * 是同一个组件的三种状态，不是三套画法。
 */
import { useId, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import type { CardView } from '../race/cards/types.ts'
import type { Lang } from '../ui/i18n.ts'
import { t } from '../ui/i18n.ts'
import { activateOnKey } from './cardKeys.ts'

/** 来自 public/assets/placeholder/ui/card_frame.json 的实测矩形 */
const FRAME = {
  common: {
    src: '/assets/placeholder/ui/card_frame_common.webp',
    w: 798,
    h: 900,
    art: [100, 111, 589, 546],
    ribbon: [72, 661, 698, 150],
  },
  rare: {
    src: '/assets/placeholder/ui/card_frame_rare.webp',
    w: 757,
    h: 900,
    art: [87, 142, 572, 528],
    ribbon: [62, 674, 631, 146],
  },
} as const

function pct(v: number, total: number): string {
  return `${(v / total) * 100}%`
}

export type CardSize = 'choice' | 'hud' | 'review' | 'gallery' | 'collectible'

const HEIGHTS: Record<CardSize, number> = { choice: 430, hud: 74, review: 210, gallery: 330, collectible: 330 }

export interface CardProps {
  def: CardView
  lang: Lang
  size?: CardSize
  selected?: boolean
  dimmed?: boolean
  style?: CSSProperties
  /** 给了就是一个按钮：可聚焦、Enter / 空格激活、以卡名为可访问名；不给就是纯展示 */
  onClick?: () => void
  footer?: ReactNode
  badge?: ReactNode
}

function CollectibleCardName({ name }: { name: string }) {
  const box = useRef<HTMLSpanElement>(null)
  const text = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const container = box.current!
    const label = text.current!
    const fit = () => {
      // Use layout sizes, unaffected by the reveal's rotation and breathing scale.
      if (!container.clientWidth || !container.clientHeight) return
      const maxSize = parseFloat(getComputedStyle(container).fontSize)
      label.style.fontSize = `${maxSize}px`
      const fits = () => label.scrollWidth <= container.clientWidth - 1 && label.offsetHeight <= container.clientHeight - 1
      if (fits()) return
      // Measure each candidate: fixed letter spacing does not shrink with the font.
      let low = 0
      let high = maxSize
      while (high - low > .1) {
        const candidate = (low + high) / 2
        label.style.fontSize = `${candidate}px`
        if (fits()) low = candidate
        else high = candidate
      }
      label.style.fontSize = `${low}px`
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(container)
    let active = true
    void document.fonts.ready.then(() => { if (active) fit() })
    document.fonts.addEventListener('loadingdone', fit)
    return () => { active = false; observer.disconnect(); document.fonts.removeEventListener('loadingdone', fit) }
  }, [name])
  return <span ref={box} className="h-title collectible-card-name"><span ref={text}>{name}</span></span>
}

export function Card({
  def,
  lang,
  size = 'choice',
  selected,
  dimmed,
  style,
  onClick,
  footer,
  badge,
}: CardProps) {
  const f = FRAME[def.quality]
  const h = HEIGHTS[size]
  const scale = h / f.h
  const w = f.w * scale
  const [ax, ay, aw, ah] = f.art
  const [rx, ry, rw, rh] = f.ribbon
  const compact = size === 'hud'
  const nameSize = Math.max(11, Math.round(h * (compact ? 0.11 : 0.056)))
  const descSize = Math.max(9, Math.round(h * 0.035))
  const descId = useId()
  // 两种形态共用的根属性：E2E 与排版检查器靠 card-root / data-card / data-quality 找卡面
  const root = {
    className: `card-root${size === 'collectible' ? ' card-collectible' : ''}`,
    'data-card': def.cardId,
    'data-quality': def.quality,
    style: {
      position: 'relative',
      width: w,
      height: h,
      flex: '0 0 auto',
      cursor: onClick ? 'pointer' : 'default',
      opacity: dimmed ? 0.38 : 1,
      filter: selected ? 'drop-shadow(0 0 22px rgba(249,199,79,0.95))' : undefined,
      transition: 'opacity 200ms ease, filter 200ms ease',
      ...style,
    } satisfies CSSProperties,
  }

  // The reveal template contains its illustrated frame. Keep card data and accessible semantics here.
  const face = size === 'collectible' ? <>
    <img className="collectible-card-icon" src={cardIconUrl(def.art.icon)} alt="" draggable={false}
      style={{ filter: def.art.tint ? `hue-rotate(${def.art.tint}deg) saturate(1.25)` : undefined }}/>
    <CollectibleCardName name={def.name[lang]}/>
    {footer}
  </> : (
    <>
      <img
        src={f.src}
        alt=""
        draggable={false}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />
      {/* 画面区：图标 + 效果描述 */}
      <div
        style={{
          position: 'absolute',
          left: pct(ax, f.w),
          top: pct(ay, f.h),
          width: pct(aw, f.w),
          height: pct(ah, f.h),
          display: compact ? 'flex' : 'grid',
          gridTemplateRows: compact ? undefined : 'minmax(0, 1fr) auto',
          justifyItems: 'center',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: compact ? 'center' : 'flex-start',
          gap: compact ? 0 : '4%',
          padding: compact ? 0 : '3% 2% 0',
        }}
      >
        <img
          src={cardIconUrl(def.art.icon)}
          alt=""
          draggable={false}
          style={{
            width: compact ? '86%' : '52%',
            aspectRatio: '1 / 1',
            height: compact ? undefined : '100%',
            maxHeight: '100%',
            minHeight: 0,
            objectFit: 'contain',
            filter: def.art.tint ? `hue-rotate(${def.art.tint}deg) saturate(1.25)` : undefined,
          }}
        />
        {!compact && (
          <p
            id={descId}
            style={{
              margin: 0,
              width: '100%',
              fontSize: descSize,
              lineHeight: 1.42,
              color: '#4a2a14',
              textAlign: 'center',
              fontWeight: 600,
            }}
          >
            {def.desc[lang]}
          </p>
        )}
      </div>
      {/* 缎带：卡名 */}
      <div
        style={{
          position: 'absolute',
          left: pct(rx, f.w),
          top: pct(ry, f.h),
          width: pct(rw, f.w),
          height: pct(rh, f.h),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 6%',
        }}
      >
        {!compact && (
          <span
            className="h-title"
            style={{
              fontSize: nameSize,
              color: '#5b2d10',
              textAlign: 'center',
              lineHeight: 1.1,
              textShadow: '0 1px 0 rgba(255,255,255,0.4)',
            }}
          >
            {def.name[lang]}
          </span>
        )}
      </div>
      {/* 品质角标 */}
      {badge ?? (
        <span
          style={{
            position: 'absolute',
            right: compact ? 2 : 10,
            top: compact ? 2 : 10,
            fontSize: Math.max(9, Math.round(h * 0.028)),
            fontWeight: 800,
            padding: compact ? '1px 4px' : '3px 9px',
            borderRadius: 999,
            background: def.quality === 'rare' ? 'rgba(244,162,42,0.95)' : 'rgba(120,86,60,0.85)',
            color: '#fff',
            letterSpacing: 1,
          }}
        >
          {t(lang, def.quality === 'rare' ? 'card.rare' : 'card.common')}
        </span>
      )}
      {footer}
    </>
  )

  if (!onClick) return <div {...root}>{face}</div>
  return (
    <div
      {...root}
      role="button"
      tabIndex={0}
      aria-label={def.name[lang]}
      // 按钮的子树对读屏是展示性的：效果描述要显式挂成说明，否则只读得到卡名
      aria-describedby={compact || size === 'collectible' ? undefined : descId}
      onClick={onClick}
      onKeyDown={(e) => activateOnKey(e, onClick)}
    >
      {face}
    </div>
  )
}
