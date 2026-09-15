/** 五匹马的外观。颜色取自 assrt/race_start.png 的闸门排布，horseId 与颜色绑定，不随赛道变 */
export interface HorseProfile {
  horseId: number
  name: string
  nameEn: string
  body: number
  bodyShade: number
  mane: number
  maneShade: number
  hoof: number
}

function shade(c: number, k: number): number {
  const r = Math.round(((c >> 16) & 0xff) * k)
  const g = Math.round(((c >> 8) & 0xff) * k)
  const b = Math.round((c & 0xff) * k)
  return (r << 16) | (g << 8) | b
}

function make(
  horseId: number,
  name: string,
  nameEn: string,
  body: number,
  mane: number,
): HorseProfile {
  return {
    horseId,
    name,
    nameEn,
    body,
    bodyShade: shade(body, 0.82),
    mane,
    maneShade: shade(mane, 0.78),
    hoof: shade(body, 0.55),
  }
}

export const HORSE_PROFILES: HorseProfile[] = [
  make(0, 'Kiruno', 'Kiruno', 0xf5ede0, 0x6b3f22),
  make(1, 'Shadow', 'Shadow', 0x343842, 0x4a79c4),
  make(2, 'Berry', 'Berry', 0xf6c2d0, 0xe8799f),
  make(3, 'Cloud', 'Cloud', 0xf2f5f8, 0x9bc7e8),
  make(4, 'Thunder', 'Thunder', 0x2e2a24, 0xe8b93c),
]

export function hexCss(c: number): string {
  return '#' + c.toString(16).padStart(6, '0')
}
