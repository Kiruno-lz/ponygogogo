import { helixPoint, SPIN_THRUST_ART } from './spin-thrust-motion.ts'

function alphaBounds(image: HTMLImageElement, threshold: number) {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d')!
  context.drawImage(image, 0, 0)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  let left = canvas.width, right = 0, top = canvas.height, bottom = 0
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    if (pixels[(y * canvas.width + x) * 4 + 3]! <= threshold) continue
    left = Math.min(left, x); right = Math.max(right, x)
    top = Math.min(top, y); bottom = Math.max(bottom, y)
  }
  return { left, top, width: right - left + 1, height: bottom - top + 1 }
}

function redTip(image: HTMLImageElement) {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d')!
  context.drawImage(image, 0, 0)
  const pixels = context.getImageData(0, 0, image.width, image.height).data
  let farthest = 0
  const red: [number, number][] = []
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const index = (y * image.width + x) * 4
    if (pixels[index + 3]! > 32 && pixels[index]! > pixels[index + 1]! * 1.15
      && pixels[index]! > pixels[index + 2]! * 1.12) {
      farthest = Math.max(farthest, x)
      red.push([x, y])
    }
  }
  const tip = red.filter(([x]) => x >= farthest - 5)
  return { x: farthest, y: tip.reduce((sum, [, y]) => sum + y, 0) / tip.length }
}

function drawFrame(context: CanvasRenderingContext2D, ribbon: HTMLImageElement,
  reference: HTMLImageElement, phase: number) {
  const art = SPIN_THRUST_ART
  const material = alphaBounds(ribbon, 4)
  const tip = redTip(reference)
  const coreHeight = reference.width * 0.03
  // Preserve the approved core, embedded red filaments and sharp tip as source artwork.
  context.globalAlpha = 0.8
  context.drawImage(reference, 0, tip.y - coreHeight / 2, reference.width, coreHeight,
    art.startX, art.axisY - art.length * 0.015, art.length, art.length * 0.03)
  const referenceScale = art.length / reference.width
  context.drawImage(reference, tip.x - 220, tip.y - 55, 220, 110,
    art.startX + art.length - 220 * referenceScale, art.axisY - 55 * referenceScale,
    220 * referenceScale, 110 * referenceScale)
  const segments = 384
  const stripWidth = material.width * 0.9
  const stripLeft = material.left + material.width * 0.05
  for (let segment = 0; segment < segments; segment++) {
    const u = segment / segments
    const nextU = (segment + 1) / segments
    const samples = ([0, 1] as const).map((strand) => ({
      start: helixPoint(u, phase, strand), end: helixPoint(nextU, phase, strand),
      middle: helixPoint((u + nextU) / 2, phase, strand),
    })).sort((a, b) => a.middle.depth - b.middle.depth)
    for (const { start, end, middle } of samples) {
      // A textured mesh strip, not a rigid sprite transform: every point advances in phase.
      const width = end.x - start.x
      const textureU = ((u * art.turns + phase / (Math.PI * 2)) % 1 + 1) % 1
      const sourceWidth = stripWidth * art.turns / segments
      const sourceX = stripLeft + Math.min(textureU * stripWidth, stripWidth - sourceWidth)
      const dx = end.x - start.x, dy = end.y - start.y
      const magnitude = Math.hypot(dx, dy)
      const normalX = -dy / magnitude, normalY = dx / magnitude
      context.save()
      context.globalAlpha = middle.opacity
      context.transform(dx, dy, normalX * middle.thickness, normalY * middle.thickness,
        start.x - normalX * middle.thickness / 2, start.y - normalY * middle.thickness / 2)
      context.drawImage(ribbon, sourceX, material.top, sourceWidth, material.height,
        0, 0, 1 + 0.3 / width, 1)
      context.restore()
    }
  }
  context.globalAlpha = 1
}

async function image(url: string) {
  const value = new Image()
  value.src = url
  await value.decode()
  return value
}

// Only exposed in the offline authoring page, never imported into the game.
;(window as any).renderSpinThrust = async (ribbonUrl: string, referenceUrl: string) => {
  const [ribbon, reference] = await Promise.all([image(ribbonUrl), image(referenceUrl)])
  const art = SPIN_THRUST_ART
  const scale = 2
  const canvas = document.createElement('canvas')
  canvas.width = art.frameWidth * 4 * scale
  canvas.height = art.frameHeight * 4 * scale
  const context = canvas.getContext('2d')!
  for (let frame = 0; frame < art.frameCount; frame++) {
    context.save()
    context.translate(frame % 4 * art.frameWidth * scale, Math.floor(frame / 4) * art.frameHeight * scale)
    context.scale(scale, scale)
    drawFrame(context, ribbon, reference, frame * Math.PI * 2 / art.frameCount)
    context.restore()
  }
  return canvas.toDataURL('image/png')
}
