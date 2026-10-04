import { expect, test } from '@playwright/test'
import { enterHome, open } from '../helpers.ts'

test('真实试玩中 CPU 获得装备不播放获得音效，非零玩家槽位保留自己的检查点声音', async ({ page }) => {
  await open(page, `raceSpeed=16&seed=0x${'01'.repeat(32)}`)
  await enterHome(page)
  await page.evaluate(async () => {
    const audioPath = '/src/assets/audio.ts', driverPath = '/src/race/driver.ts'
    const { AudioManager } = await import(audioPath)
    const { RaceDriver } = await import(driverPath)
    const log = { player: -1, events: [] as { type: string; horseId?: number }[], sounds: [] as string[] }
    ;(window as unknown as { cpuAudio: typeof log }).cpuAudio = log
    const play = AudioManager.prototype.play, update = RaceDriver.prototype.update
    AudioManager.prototype.play = function (key: string, gain?: number, rate?: number) {
      log.sounds.push(key)
      return play.call(this, key, gain, rate)
    }
    RaceDriver.prototype.update = function (now: number) {
      const events = update.call(this, now)
      log.player = this.state.playerHorseId
      log.events.push(...events)
      return events
    }
  })
  await page.getByRole('button', { name: /开始游戏|START/ }).first().click()
  await expect(page.getByTestId('screen-select')).toBeVisible()
  await page.locator('.horse-choice[data-lane="3"]').click()
  await page.locator('.select-race-cta button').click()
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline && !await page.getByTestId('screen-result').isVisible()) {
    const skip = page.getByTestId('card-skip')
    if (await skip.isVisible()) await skip.click()
    await page.waitForTimeout(100)
  }
  await expect(page.getByTestId('screen-result')).toBeVisible()
  const log = await page.evaluate(() => (window as unknown as { cpuAudio: {
    player: number; events: { type: string; horseId?: number }[]; sounds: string[]
  } }).cpuAudio)
  expect(log.player).toBe(3)
  expect(log.events.filter(e => e.type === 'equipOn' && e.horseId !== log.player).length).toBeGreaterThan(0)
  const checkpoints = log.events.filter(e => e.type === 'checkpoint' && e.horseId === log.player)
  expect(checkpoints.length).toBeGreaterThan(0)
  expect(log.sounds.filter(key => key === 'audio.sfx_checkpoint')).toHaveLength(checkpoints.length)
  expect(log.sounds).not.toContain('audio.sfx_card_pick')
  expect(log.sounds).not.toContain('audio.sfx_equip')
  expect(log.sounds).not.toContain('audio.sfx_card_refresh')
})
