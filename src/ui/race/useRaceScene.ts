import Phaser from 'phaser'
import { assetFailure } from '../../assets/errors.ts'
import { useEffect, useRef, useState } from 'react'
import { DESIGN_H, DESIGN_W } from '../../game/layout.ts'
import { RaceScene } from '../../game/RaceScene.ts'
import { normalizeRoster, ponyById } from '../../game/ponyCatalog.ts'
import { preparePonyImages } from '../../game/pony.ts'
import { prepareSceneImages } from '../../game/sceneArt.ts'
import type { RaceScreenProps } from './types.ts'

export function useRaceScene(p: Pick<RaceScreenProps, 'driver' | 'urls' | 'reducedMotion' | 'onSceneReady'>) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const gameRef = useRef<Phaser.Game | null>(null)
  const sceneRef = useRef<RaceScene | null>(null)
  const [sceneError, setSceneError] = useState<ReturnType<typeof assetFailure> | null>(null)
  const [sceneAttempt, setSceneAttempt] = useState(0)
  // Phaser 生命周期
  useEffect(() => {
    if (!hostRef.current || gameRef.current) return
    let disposed = false
    let game: Phaser.Game | null = null
    const profiles = normalizeRoster(p.driver.state.roster).map(ponyById)
    void Promise.all([preparePonyImages(profiles, p.urls), prepareSceneImages(p.urls)]).then(([ponyImages, sceneImages]) => {
      if (disposed || !hostRef.current || gameRef.current) return
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: hostRef.current,
        width: DESIGN_W,
        height: DESIGN_H,
        backgroundColor: '#6f9efa',
        transparent: true,
        scale: { mode: Phaser.Scale.NONE, autoCenter: Phaser.Scale.NO_CENTER },
        render: { antialias: true, roundPixels: false },
        audio: { noAudio: true },
        banner: false,
        scene: [RaceScene],
      })
      gameRef.current = game
      game.scene.start('race', {
        driver: p.driver,
        urls: p.urls,
        reducedMotion: p.reducedMotion,
        ponyImages,
        sceneImages,
        onReady: (scene: RaceScene) => {
          sceneRef.current = scene
          scene.setReducedMotion(p.reducedMotion)
          p.onSceneReady?.()
        },
      })
    }).catch(error => {
      if (!disposed) setSceneError(assetFailure(error))
    })
    return () => {
      disposed = true
      gameRef.current = null
      sceneRef.current = null
      game?.destroy(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneAttempt])

  useEffect(() => {
    sceneRef.current?.setReducedMotion(p.reducedMotion)
  }, [p.reducedMotion])

  return { hostRef, sceneRef, sceneError, retryScene: () => { setSceneError(null); setSceneAttempt(n => n + 1) } }
}
