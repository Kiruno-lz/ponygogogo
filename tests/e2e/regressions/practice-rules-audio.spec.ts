import { expect, test } from '@playwright/test'
import { enterHome, open, startRace } from '../helpers.ts'

for (const scenario of [
  { name: '第一名', seed: '0x55854f87801942d6914cec9a4643de76a72b057254ce0a2d041dad7ae8c880bc', rank: 1, jingle: 'audio.jingle_win', pick: true },
  { name: '第四名', seed: '0x5d837b839bafc6f78af9bdcc08bbec09ddda86dd49949cb66f70b7f0a59cc08b', rank: 4, jingle: 'audio.jingle_lose', pick: false },
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
    if (await skip.isVisible()) {
      if (scenario.pick) {
        const choice = page.getByTestId('card-choice-0')
        await expect(choice).toHaveCSS('opacity', '1')
        await choice.locator('.card-root').click()
      } else await skip.click()
    }
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
