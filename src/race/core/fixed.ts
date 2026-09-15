/**
 * 定点整数算术。规则内核不出现浮点：全部量以 FP = 10000 为比例因子的整数表示，
 * 除法一律显式向零截断，不依赖语言默认舍入。
 */

export type Fixed = number

/** 比例因子：1.0 === FP */
export const FP = 10000

/** 由十进制数构造定点数（仅允许在常量定义与外层输入处使用） */
export function fx(n: number): Fixed {
  return Math.trunc(n * FP)
}

/** 定点乘法，向零截断 */
export function mulFx(a: Fixed, b: Fixed): Fixed {
  return Math.trunc((a * b) / FP)
}

/** 定点除法，向零截断 */
export function divFx(a: Fixed, b: Fixed): Fixed {
  if (b === 0) return 0
  return Math.trunc((a * FP) / b)
}

/** 整数除法，向零截断 */
export function divTrunc(a: number, b: number): number {
  if (b === 0) return 0
  return Math.trunc(a / b)
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function absInt(v: number): number {
  return v < 0 ? -v : v
}

/** 定点数转显示用小数（仅表现层可用） */
export function toNum(v: Fixed): number {
  return v / FP
}
