import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CollectionScreen } from '../../../src/ui/CollectionScreen.tsx'
import type { Lang } from '../../../src/ui/i18n.ts'
import '../../../src/ui/theme.css'

function Fixture() {
  const [owned, setOwned] = useState<readonly number[] | null>(null)
  const [lang, setLang] = useState<Lang>('zh')
  return <><div style={{ width: 1619, height: 971, position: 'relative' }}>
    <CollectionScreen lang={lang} signedIn ownedRareIds={['C-02']} ownedPonyIds={owned}
      onUnlock={() => setOwned([5,8])} onBack={() => {}} />
  </div><button type="button" onClick={() => setLang('en')}>English</button></>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
