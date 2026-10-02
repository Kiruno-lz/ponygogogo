/** Browser-only art regression: verbose card copy must remain inside the parchment area. */
export function assertCardCopyFits() {
  const failures = []
  const slots = [...document.querySelectorAll('[data-card]')]
  const cards = slots.filter(card => card.classList.contains('card-root'))
  for (const card of cards) {
    const art = card.querySelector(':scope > div')
    const paragraph = art?.querySelector('p')
    if (!paragraph) continue
    const region = art.getBoundingClientRect()
    const copy = paragraph.getBoundingClientRect()
    if (copy.bottom > region.bottom + 1 || copy.right > region.right + 1) {
      failures.push({ card: card.getAttribute('data-card'), overflow: Math.round(copy.bottom - region.bottom) })
    }
  }
  if (failures.length) throw new Error(`Card descriptions overlap the ribbon: ${JSON.stringify(failures)}`)
  return { cards: slots.length, faces: cards.length, locked: slots.length - cards.length, overflow: 0 }
}
