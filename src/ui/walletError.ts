/** 钱包错误码 → 界面文案。未知错误才带上原始信息，已知错误给出具体引导。 */
import { WalletError } from '../chain/wallet.ts'
import { t, type Lang } from './i18n.ts'

export function walletErrorText(lang: Lang, err: unknown): string {
  if (err instanceof WalletError && err.code !== 'unknown') return t(lang, `wallet.err.${err.code}`)
  return t(lang, 'wallet.err.unknown', { detail: err instanceof Error ? err.message : String(err) })
}
