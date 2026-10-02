/** Remove the white matte deterministically, without regenerating QR modules or the logo. */
import { PNG } from 'pngjs'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export function transparentQr(source: PNG): PNG {
  const output = new PNG({ width: source.width, height: source.height })
  output.data = Buffer.from(source.data)
  // White inside the colored shield is the horse's coat, so preserve it.
  // Coordinates belong to the QR master; the crown and colored outline stay unchanged.
  const shield = [[.40, .386], [.586, .386], [.618, .417], [.618, .574], [.59, .625], [.41, .625], [.378, .587], [.378, .417]]
  function insideShield(x: number, y: number) {
    let inside = false
    for (let i = 0, j = shield.length - 1; i < shield.length; j = i++) {
      const [xi, yi] = shield[i]; const [xj, yj] = shield[j]
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside
    }
    return inside
  }
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    const i = (y * source.width + x) * 4
    const min = Math.min(source.data[i], source.data[i + 1], source.data[i + 2])
    const max = Math.max(source.data[i], source.data[i + 1], source.data[i + 2])
    if (max - min > 1 || insideShield(x / source.width, y / source.height)) continue
    // Recover black coverage from its white matte, including antialiased module edges.
    output.data[i] = output.data[i + 1] = output.data[i + 2] = 0
    output.data[i + 3] = Math.round((255 - min) * source.data[i + 3] / 255)
  }
  return output
}

if (import.meta.main) {
  const source = new URL('../art-src/QR code.png', import.meta.url)
  const destination = new URL('../art-src/art/share/qr.png', import.meta.url)
  mkdirSync(dirname(destination.pathname), { recursive: true })
  writeFileSync(destination, PNG.sync.write(transparentQr(PNG.sync.read(readFileSync(source)))))
}
