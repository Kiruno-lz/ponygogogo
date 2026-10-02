import { expect, test } from '@playwright/test'
import { enterHome, open, startRace } from '../helpers.ts'

for (const scenario of [
  { name: '第一名', seed: '0x1392a0fad7b856b4280fa6a49b9f94b5c6750704fe174d8e69593c48a2ad66c3', rank: 1, jingle: 'audio.jingle_win' },
  { name: '第四名', seed: '0x4fdb69ec1b941cfb03e40bb79d4b857d2b99eb097be86b4b2592842eb3f094f0', rank: 4, jingle: 'audio.jingle_lose' },
]) test(`免费试玩${scenario.name}：玩家冲线播放正确旋律一次，电脑马和结算页不重复播放`, async ({ page }, testInfo) => {
  await open(page, `raceSpeed=16&seed=${scenario.seed}`)
  await enterHome(page)
  // Observe the real AudioManager calls while retaining actual playback and the complete game UI.
  await page.evaluate(async () => {
    const path = '/src/assets/audio.ts'
    const { AudioManager } = await import(path)
    const play = AudioManager.prototype.play
    const sounds: string[] = []
    ;(window as unknown as { practiceSounds: string[] }).practiceSounds = sounds
    AudioManager.prototype.play = function (key: string, gain?: number, rate?: number) {
      sounds.push(key)
      return play.call(this, key, gain, rate)
    }
  })
  await startRace(page, 2)
  const end = Date.now() + 90_000
  while (Date.now() < end && !await page.getByTestId('screen-result').isVisible()) {
    const skip = page.getByTestId('card-skip')
    if (await skip.isVisible()) await skip.click()
    await page.waitForTimeout(100)
  }
  await expect(page.getByTestId('screen-result')).toBeVisible()
  await expect(page.getByTestId('result-rank')).toHaveText(String(scenario.rank))
  await page.screenshot({ path: testInfo.outputPath(`${scenario.rank}-result.png`) })
  const sounds = await page.evaluate(() => (window as unknown as { practiceSounds: string[] }).practiceSounds)
  expect(sounds.filter((key) => key === 'audio.jingle_win' || key === 'audio.jingle_lose')).toEqual([scenario.jingle])
  expect(sounds).not.toContain('audio.sfx_finish')
  expect(sounds.filter((key) => key === 'audio.sfx_result_open')).toHaveLength(1)
  await expect(page.getByTestId('screen-result')).not.toContainText('MON')
})
