import { expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import { renderToStaticMarkup } from 'react-dom/server'
import { CollectionScreen } from '../../../src/ui/collection/CollectionScreen.tsx'
import { posterContent } from '../../../src/export/poster.ts'
import { RaceDriver } from '../../../src/race/driver.ts'
import { t } from '../../../src/ui/i18n.ts'

const root = resolve(import.meta.dir, '../../..')
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? sources(join(dir, e.name)) : [join(dir, e.name)])
}

test('all authored Chinese text is editable in the central dictionary', () => {
  const stray: string[] = []
  for (const path of sources(join(root, 'src')).filter(p => /\.tsx?$/.test(p) && !p.includes('.test.') && !p.endsWith('/i18n.ts'))) {
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
    function visit(node: ts.Node) {
      if ((ts.isStringLiteralLike(node) || ts.isJsxText(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && /[\u3400-\u9fff]/.test(node.text)) {
        stray.push(`${path.slice(root.length + 1)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  expect(stray).toEqual([])
})

test('collection category and unlock controls use the same translated strings as the dictionary', () => {
  const html = renderToStaticMarkup(<CollectionScreen lang="zh" onBack={() => {}} signedIn ownedRareIds={[]} ownedPonyIds={[]} onUnlock={() => {}} />)
  for (const key of ['collection.cards', 'collection.ponies', 'collection.unlock']) {
    expect(html).toContain(t('zh', key))
    expect(t('zh', key)).not.toBe(key)
  }
})

test('an English exported result uses the localized role name', () => {
  const driver = new RaceDriver({ seed: `0x${'11'.repeat(32)}`, playerHorseId: 0, stakeTier: 0, roster: [8, 1, 2, 3, 4] })
  expect(posterContent(driver.buildResult('i18n-poster'), undefined, 'en').name).toBe('Gugu Gaga')
})

test('missing translation keys fail explicitly instead of showing an internal key to players', () => {
  expect(() => t('zh', 'missing.copy')).toThrow('MISSING_TRANSLATION')
})

test('compact bilingual effects preserve authored blanks, strength marks and template parameters', () => {
  const keys = Array.from({ length: 40 }, (_, index) => `card.C-${String(index + 1).padStart(2, '0')}.effect`)
  for (const ability of ['rareSpecialist', 'refresh', 'longEquipment', 'diverse', 'airborne', 'ox', 'forfeit', 'food', 'repeat']) {
    keys.push(`pony.ability.${ability}.name`, `pony.ability.${ability}.description`)
  }
  for (const key of keys) {
    const zh = t('zh', key), en = t('en', key)
    expect(en === '', key).toBe(zh === '')
    expect(en.match(/[+-]+/g) ?? [], key).toEqual(zh.match(/[+-]+/g) ?? [])
    expect((en.match(/\{\w+\}/g) ?? []).sort(), key).toEqual((zh.match(/\{\w+\}/g) ?? []).sort())
  }
})
