import { decodeImage } from './images.ts'
import { EFFECT_TEXTURES, HEAD_COSMETIC_TEXTURES } from './effects.ts'

export type SceneImages = Record<string, HTMLImageElement>

export async function prepareSceneImages(urls: Record<string, string>): Promise<SceneImages> {
  const sources = {
    'art.far': urls['art.track.far'],
    'art.front': urls['art.track.front'],
    'art.track': urls['art.track.track'],
    'fx.gold-ring': urls['art.ui.gold-ring-trimmed'],
    'fx.dust': urls['art.ui.dust-trimmed'],
    ...Object.fromEntries(
      [...Object.values(EFFECT_TEXTURES), ...Object.values(HEAD_COSMETIC_TEXTURES)]
        .map((spec) => [spec.textureKey, urls[spec.assetKey]]),
    ),
  }
  const images: SceneImages = {}
  await Promise.all(Object.entries(sources).map(async ([key, url]) => {
    images[key] = await decodeImage(url!)
  }))
  return images
}
