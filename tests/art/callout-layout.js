/** Source RACE lettering occupies the upper cream face, not the lower gold tip. */
export function assertRaceCalloutRegistration() {
  const stage = document.querySelector('[data-testid="stage"]')
  const label = document.querySelector('.select-race-cta .big')
  if (!stage || !label) throw new Error('Horse selection must be visible')
  const canvas = stage.getBoundingClientRect()
  const scale = canvas.width / 1619
  const rect = label.getBoundingClientRect()
  const top = (rect.top - canvas.top) / scale
  const bottom = (rect.bottom - canvas.top) / scale
  if (top < 650 || top > 690 || bottom > 825) {
    throw new Error(`RACE lettering misses the source cream face: top=${top.toFixed(1)}, bottom=${bottom.toFixed(1)}`)
  }
  return { top: Math.round(top), bottom: Math.round(bottom) }
}
