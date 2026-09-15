/**
 * 确定性随机：唯一随机源。全部随机性都来自本场 seed 的域分离派生。
 * 规则内核禁止 Math.random、禁止读系统时钟。
 */
import { FP, type Fixed } from './fixed.ts'

/** FNV-1a + 雪崩混合，纯 32 位整数运算，跨运行时结果一致 */
function hashString(str: string): number {
  let h = 0x811c9dc5 >>> 0
  for (let i = 0; i < str.length; i++) {
    h = (h ^ str.charCodeAt(i)) >>> 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  h = (h ^ (h >>> 16)) >>> 0
  h = Math.imul(h, 0x85ebca6b) >>> 0
  h = (h ^ (h >>> 13)) >>> 0
  h = Math.imul(h, 0xc2b2ae35) >>> 0
  h = (h ^ (h >>> 16)) >>> 0
  return h >>> 0
}

/** H(seed, domain, ...args) -> uint32 */
export function H(seed: string, domain: string, ...args: number[]): number {
  return hashString(seed + '|' + domain + '|' + args.join(','))
}

/** 均匀取 [0, n) 的整数 */
export function hRange(seed: string, domain: string, args: number[], n: number): number {
  if (n <= 0) return 0
  return H(seed, domain, ...args) % n
}

/** 映射到定点区间 [-1, 1] */
export function hSigned(seed: string, domain: string, ...args: number[]): Fixed {
  const u = H(seed, domain, ...args)
  // 取低 16 位映射到 [0, 2*FP]，再平移到 [-FP, FP]
  const low = u & 0xffff
  return Math.trunc((low * (2 * FP)) / 0xffff) - FP
}

/** 映射到定点区间 [0, 1] */
export function hUnit(seed: string, domain: string, ...args: number[]): Fixed {
  const u = H(seed, domain, ...args)
  const low = u & 0xffff
  return Math.trunc((low * FP) / 0xffff)
}

/** 生成一个本地 seed 字符串（仅 mock 链端口使用，不进规则内核） */
export function makeSeed(entropy: number): string {
  const a = hashString('seed-a|' + entropy).toString(16).padStart(8, '0')
  const b = hashString('seed-b|' + entropy).toString(16).padStart(8, '0')
  const c = hashString('seed-c|' + entropy).toString(16).padStart(8, '0')
  const d = hashString('seed-d|' + entropy).toString(16).padStart(8, '0')
  return '0x' + a + b + c + d
}
