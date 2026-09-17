/** Decode PNG artwork before mounting the renderer so its first frame is complete. */
export function decodeImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`PNG artwork decode failed: ${url}`))
    image.src = url
  })
}
