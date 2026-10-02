/** Card, HUD, result and poster share the same source artwork. */
export function cardIconUrl(icon: string): string {
  return icon.startsWith('card-') ? `/assets/cards/${icon}.svg` : `/assets/placeholder/icons/${icon}.webp`
}
