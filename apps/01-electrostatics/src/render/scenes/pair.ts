import * as THREE from 'three'
import type { Scene, SceneCtx } from './types'

/** Beat 1: a neutral pair pulled apart into + and −. */
export function createPairScene(ctx: SceneCtx): Scene {
  const { physics, markers, arrows, colors } = ctx
  const group = new THREE.Group()
  const neutralGeo = new THREE.SphereGeometry(0.1, 32, 24)
  const neutralMat = new THREE.MeshStandardMaterial({ color: colors.shell, roughness: 0.5 })
  const neutral = new THREE.Mesh(neutralGeo, neutralMat)
  const a = markers.make(1, 0.08)
  const b = markers.make(-1, 0.08)
  const fa = arrows.make(colors.line, 0.014)
  const fb = arrows.make(colors.line, 0.014)
  group.add(neutral, a.object, b.object, fa.object, fb.object)
  return {
    group,
    sync() {
      const p = physics.pair
      const pos = p.positions()
      const showPair = p.apart > 0.05
      neutral.visible = !showPair
      a.object.visible = showPair
      b.object.visible = showPair
      a.setPosition(pos.a.x, pos.a.y, pos.a.z)
      b.setPosition(pos.b.x, pos.b.y, pos.b.z)
      a.setSign(1)
      b.setSign(p.same ? 1 : -1)
      const att = p.attraction()
      const len = 0.28
      if (att === 0) {
        fa.setVisible(false)
        fb.setVisible(false)
      } else {
        fa.setDirection({ x: pos.a.x + 0.1 * att, y: 0, z: 0 }, { x: att, y: 0, z: 0 }, len)
        fb.setDirection({ x: pos.b.x - 0.1 * att, y: 0, z: 0 }, { x: -att, y: 0, z: 0 }, len)
      }
    },
    dispose() {
      neutralGeo.dispose()
      neutralMat.dispose()
    },
  }
}
