import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
const copyCheck = readFileSync(new URL('../../art/card-layout.js',import.meta.url),'utf8').replace('export function','function')
test('nineteen actual card faces load and fit in Chinese and English',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('/tests/e2e/fixtures/new-cards.html')
 for(const lang of ['zh','en']) {
  await expect(page.locator('.card-root')).toHaveCount(19)
  await page.locator('.card-root img').evaluateAll(imgs=>Promise.all(imgs.map(img=>(img as HTMLImageElement).decode())))
  expect(await page.evaluate(`(${copyCheck})()`)).toEqual({cards:19,faces:19,locked:0,overflow:0})
  if(lang==='zh') await page.getByRole('button',{name:'zh',exact:true}).click()
 }
 expect(errors).toEqual([])
 await page.screenshot({path:'tests/e2e/screenshots/new-cards-en.png',fullPage:true})
})
test('new cards can be selected through the actual three-card panel',async({page})=>{
 await page.goto('/tests/e2e/fixtures/new-cards.html');await page.getByRole('button',{name:'choice',exact:true}).click()
 await expect(page.locator('.card-root')).toHaveCount(3)
 for (let i=0;i<3;i++) await expect(page.getByTestId(`card-choice-${i}`)).toHaveCSS('opacity','1')
 await page.locator('.card-root img').evaluateAll(imgs=>Promise.all(imgs.map(img=>(img as HTMLImageElement).decode())))
 expect(await page.evaluate(`(${copyCheck})()`)).toEqual({cards:3,faces:3,locked:0,overflow:0})
 await page.screenshot({path:'tests/e2e/screenshots/new-cards-choice.png'})
 await page.getByRole('button',{name:'改装达人',exact:true}).click()
 await expect(page.getByTestId('picked')).toHaveText('C-31')
})
test('the event-solver HUD shows a refreshed wheel for thirty simulated seconds',async({page})=>{
 await page.goto('/tests/e2e/fixtures/new-cards.html');await page.getByRole('button',{name:'hud',exact:true}).click()
 await expect(page.locator('.race-hud')).toBeVisible()
 await expect(page.locator('.race-hud img[src*="buff-fire"]')).toBeVisible()
 await expect(page.locator('.race-hud')).toContainText('30')
 await page.locator('.race-hud img').evaluateAll(imgs=>Promise.all(imgs.map(img=>(img as HTMLImageElement).decode())))
 await page.screenshot({path:'tests/e2e/screenshots/new-cards-hud.png'})
})
