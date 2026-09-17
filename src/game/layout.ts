/** 比赛原画的完整画布与赛道注册坐标。只用于渲染。 */
export const DESIGN_W = 1619
export const DESIGN_H = 971

/** 源渲染图宽度，用于把切片缩放到设计宽度 */
export const SRC_W = 1619
export const BG_SCALE = DESIGN_W / SRC_W

export const TRACK_TOP = 356
export const TRACK_BOTTOM = 769
export const LANE_COUNT = 5
export const LANE_H = (TRACK_BOTTOM - TRACK_TOP) / LANE_COUNT

export function laneCenterY(laneIndex: number): number {
  return [723, 637, 553, 471.5, 394.5][laneIndex]!
}

/** 蹄子基线逐条取自原画；车道白线并非等距。 */
export function laneGroundY(laneIndex: number): number {
  return [758, 669, 588, 502, 428][laneIndex]!
}

/** 距离单位 -> 像素。一屏可见约 6000 距离单位 */
export const PX_PER_UNIT = DESIGN_W / 6000

/** 比赛原画中玩家光圈中心 x=862；起跑构图保留原画的马与白线间距。 */
export const PLAYER_ANCHOR_X = 862 / DESIGN_W
export const PLAYER_START_X = 234
export const START_LINE_X = 389

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
