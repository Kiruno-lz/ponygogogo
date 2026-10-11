import { t, type Lang } from '../i18n.ts'
import type { LoadFailure } from '../../assets/loader.ts'

export function assetFailureText(lang: Lang, failure: Pick<LoadFailure, 'message' | 'issue'>): string {
  return failure.issue ? t(lang, failure.issue.code, failure.issue.values) : t(lang, 'assets.error.unknown', { detail: failure.message })
}
