import type { CollectibleGrant } from '../chain/rewards.ts'
import { ponyById } from '../game/ponyCatalog.ts'
import { paidCardDef } from '../race/cards/paidCards.ts'
import { cardIconUrl } from '../race/cards/iconUrl.ts'
import { t, type Lang } from '../ui/i18n.ts'

/** The result modal and exported poster describe the same confirmed collectible. */
export function collectibleView(grant: CollectibleGrant, lang: Lang) {
  const cardId = `C-${String(grant.assetId).padStart(2, '0')}`
  const definition = grant.assetKind === 'rareCard' ? paidCardDef(cardId) : null
  if (grant.assetKind === 'rareCard' && !definition) throw new Error('UNKNOWN_COLLECTIBLE')
  const card = definition ? { ...definition, quality: 'rare' as const } : null
  const pony = grant.assetKind === 'pony' ? ponyById(grant.assetId) : null
  if (pony?.defaultOpen) throw new Error('UNKNOWN_COLLECTIBLE')
  return { assetKind: grant.assetKind, assetId: grant.assetId,
    name: card ? card.name[lang] : lang === 'zh' ? pony!.name : pony!.nameEn,
    kind: t(lang, card ? 'grant.rareCard' : 'grant.pony'),
    title: t(lang, 'grant.title'), collected: t(lang, 'grant.collected'),
    image: card ? cardIconUrl(card.art.icon) : `/assets/art/ponies/${pony!.ponyId}-idle-0.webp`,
    tint: card?.art.tint ?? 0, card,
  }
}
