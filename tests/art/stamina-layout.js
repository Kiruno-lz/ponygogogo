/** Full-source crop registration includes the tall lightning, not only the thin inner fill. */
export function assertSelectionStaminaRegistration() {
  const stage = document.querySelector('[data-testid="stage"]')
  const bar = document.querySelector('.select-screen .stamina-art')
  if (!stage || !bar) throw new Error('Horse selection must be visible')
  const canvas = stage.getBoundingClientRect()
  const scale = canvas.width / 1619
  const rect = bar.getBoundingClientRect()
  const actual = [(rect.left - canvas.left) / scale, (rect.top - canvas.top) / scale, rect.width / scale, rect.height / scale]
  const source = [263, 27, 382, 83]
  if (actual.some((value, i) => Math.abs(value - source[i]) > 0.5)) {
    throw new Error(`Stamina artwork misses its source crop: ${actual.map(Math.round).join(', ')}`)
  }
  return { source, registered: true }
}
