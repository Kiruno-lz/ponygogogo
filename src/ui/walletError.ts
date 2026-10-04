/** 钱包与资金错误 → 界面文案。已知错误码给出具体引导，未知错误才带上简短的原始信息。 */
import { isSponsorQuotaError } from '../chain/alchemy.ts'
import { WalletError } from '../chain/wallet.ts'
import { t, type Lang } from './i18n.ts'

const MAX_DETAIL = 160

/**
 * viem / Alchemy 的错误把完整请求体拼进 message，直接展示既难读又会刷出整段 JSON；
 * 优先取它们给人看的 `details` / `shortMessage`，再截断。
 */
export function errorDetail(err: unknown): string {
  const e = err as { details?: unknown; shortMessage?: unknown; message?: unknown }
  const pick = [e?.details, e?.shortMessage, e?.message].find((v): v is string => typeof v === 'string' && v.length > 0)
  const text = pick ?? String(err)
  return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL)}…` : text
}

export function walletErrorText(lang: Lang, err: unknown): string {
  if (err instanceof WalletError && err.code !== 'unknown') return t(lang, `wallet.err.${err.code}`)
  if (isSponsorQuotaError(err)) return t(lang, 'wallet.err.sponsor-quota')
  return t(lang, 'wallet.err.unknown', { detail: errorDetail(err) })
}
