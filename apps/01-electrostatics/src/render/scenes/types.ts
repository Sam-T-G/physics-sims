import type * as THREE from 'three'
import type { ArrowFactory, ChargeMarkerFactory } from '@lib/render'
import type { Sim1Physics } from '../../physics'
import type { SceneColors } from '../index'

/** What every scene module gets: shared factories, the palette, the physics state. */
export type SceneCtx = {
  physics: Sim1Physics
  markers: ChargeMarkerFactory
  arrows: ArrowFactory
  colors: SceneColors
  doc: Document
}

export type Scene = {
  group: THREE.Group
  /** Per frame while visible. */
  sync(): void
  dispose(): void
}
