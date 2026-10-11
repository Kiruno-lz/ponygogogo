import type { LoadFailure } from '../../assets/loader.ts'
import { assetFailureText } from '../shared/assetText.ts'
import { t, type Lang } from '../i18n.ts'

export function AssetFailures({ lang, failures }: { lang: Lang; failures: readonly LoadFailure[] }) {
  return <>
    <strong style={{ fontSize: 20 }}>{t(lang, 'loading.failed', { n: failures.length })}</strong>
    <ul className="scrolly" style={{ maxHeight: 110, margin: '8px 0', paddingLeft: 22, fontSize: 15, textAlign: 'left' }}>
      {failures.slice(0, 12).map(f => <li key={f.key}><code>{f.key}</code> — {assetFailureText(lang, f)}</li>)}
    </ul>
  </>
}
