/** Card, HUD, result and poster share the same source artwork. */
export function cardIconUrl(icon: string): string {
  return icon.startsWith('card-') ? `/assets/art/cards/${icon}.webp` : `/assets/placeholder/icons/${icon}.webp`
}
