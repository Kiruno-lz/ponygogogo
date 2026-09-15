/**
 * 画面布局常量。全部对齐 assrt/race_gaming.png 的构图：
 *   y 0–265    天空 / 城堡 / 远山 / 松林 / 看台
 *   y 250–347  木栅栏与告示牌
 *   y 340–755  五条泥土赛道（每条 83px）
 *   y 748–950  前景栅栏与观众
 */
export const DESIGN_W = 1600
export const DESIGN_H = 950

/** 源渲染图宽度，用于把切片缩放到设计宽度 */
export const SRC_W = 1619
export const BG_SCALE = DESIGN_W / SRC_W

export const TRACK_TOP = 340
export const TRACK_BOTTOM = 755
export const LANE_COUNT = 5
export const LANE_H = (TRACK_BOTTOM - TRACK_TOP) / LANE_COUNT

export function laneCenterY(laneIndex: number): number {
  return TRACK_TOP + LANE_H * (laneIndex + 0.5)
}

/** 马匹站立的基线（蹄子位置）略低于车道中心 */
export function laneGroundY(laneIndex: number): number {
  return laneCenterY(laneIndex) + LANE_H * 0.38
}

/** 距离单位 -> 像素。一屏可见约 6000 距离单位 */
export const PX_PER_UNIT = DESIGN_W / 6000

/** 玩家马固定在屏幕横向的这个比例上 */
export const PLAYER_ANCHOR_X = 0.42

/** 视差系数 */
export const PARALLAX = {
  far: 0.06,
  fence: 0.34,
  track: 1,
  front: 1.22,
}

export const PALETTE = {
  dirt: 0xb77249,
  dirtDark: 0xb16c43,
  laneLine: 0xebbe9c,
  grass: 0x58924e,
  sky: 0x6f9efa,
  wood: 0xb28168,
  woodDark: 0xa17865,
  parchment: 0xf1cdb0,
  gold: 0xf4a22a,
  ink: 0x57250c,
}

export const PALETTE_CSS = {
  dirt: '#b77249',
  dirtDark: '#b16c43',
  laneLine: '#ebbe9c',
  grass: '#58924e',
  sky: '#6f9efa',
  wood: '#b28168',
  woodDark: '#a17865',
  parchment: '#f1cdb0',
  gold: '#f4a22a',
  ink: '#57250c',
}
