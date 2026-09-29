/**
 * 原生 MON 金额的唯一换算处。链上一律按 wei 整数记账，界面只在这里与十进制字符串互转；
 * 解析严格拒绝任何可能被误读的输入（科学计数法、符号、超过 18 位小数），而不是悄悄截断。
 */

/** 1 MON = 10¹⁸ wei */
export const MON = 1_000_000_000_000_000_000n
const DECIMALS = 18
/** 超过这个长度的输入不可能是合理金额，直接拒绝，免得 BigInt 去吞一整段粘贴 */
const MAX_INPUT_LEN = 40

/** 截断（不四舍五入）到 `digits` 位小数：余额只能少报，不能多报。 */
export function formatMon(v: bigint, digits = 2): string {
  const neg = v < 0n
  const abs = neg ? -v : v
  const whole = abs / MON
  const frac = ((abs % MON) * 10n ** BigInt(digits)) / MON
  const s = digits > 0 ? `${whole}.${frac.toString().padStart(digits, '0')}` : `${whole}`
  return neg ? '-' + s : s
}

/** formatMon 去掉尾零（档位与赢奖额：0.3、1、15），截断规则不变 */
export function formatMonTrim(v: bigint, digits = 2): string {
  return formatMon(v, digits).replace(/\.?0+$/, '')
}

export type AmountParse =
  | { ok: true; wei: bigint }
  | { ok: false; reason: 'empty' | 'format' | 'zero' | 'precision' }

/** 把玩家输入的十进制 MON 金额解析成 wei。只接受 `12`、`0.5`、`.5`、`3.` 这类纯十进制写法。 */
export function parseMonAmount(input: string): AmountParse {
  const s = input.trim()
  if (s.length === 0) return { ok: false, reason: 'empty' }
  if (s.length > MAX_INPUT_LEN) return { ok: false, reason: 'format' }
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s)
  if (!m || (m[1] === '' && (m[2] ?? '') === '')) return { ok: false, reason: 'format' }
  const whole = m[1] ?? ''
  const frac = m[2] ?? ''
  if (frac.length > DECIMALS) return { ok: false, reason: 'precision' }
  const wei = BigInt(whole || '0') * MON + BigInt((frac || '0').padEnd(DECIMALS, '0'))
  if (wei === 0n) return { ok: false, reason: 'zero' }
  return { ok: true, wei }
}
