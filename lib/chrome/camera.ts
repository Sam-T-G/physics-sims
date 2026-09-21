import { gsap } from 'gsap'
import type * as THREE from 'three'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { CameraPreset } from './types'

/**
 * goToPreset: orbit controls off, one tween on camera.position and controls.target together with
 * overwrite 'auto', controls.update() every frame, controls back on when done. Camera moves never live
 * inside chapter timelines; every move goes through here, so a new goTo always starts from the live
 * camera and is idempotent from any explore state.
 */
export type CameraRig = {
  goToPreset(preset: CameraPreset, opts?: { cut?: boolean; duration?: number }): void
  /** The live camera as a preset, for explore-state snapshots. */
  snapshot(): CameraPreset
  kill(): void
}

export function createCameraRig(camera: THREE.PerspectiveCamera, controls: OrbitControls): CameraRig {
  let tl: gsap.core.Timeline | null = null
  let pending: CameraPreset | null = null
  const finish = () => {
    controls.enabled = true
    controls.update()
  }
  return {
    goToPreset(preset, opts = {}) {
      tl?.kill()
      tl = null
      const [px, py, pz] = preset.position
      const [tx, ty, tz] = preset.target
      if (opts.cut) {
        camera.position.set(px, py, pz)
        controls.target.set(tx, ty, tz)
        finish()
        return
      }
      controls.enabled = false
      pending = preset
      const duration = opts.duration ?? 1.1
      tl = gsap.timeline({
        onUpdate: () => controls.update(),
        onComplete: () => {
          pending = null
          finish()
        },
        onInterrupt: finish,
      })
      tl.to(camera.position, { x: px, y: py, z: pz, duration, ease: 'power2.inOut', overwrite: 'auto' }, 0)
      tl.to(controls.target, { x: tx, y: ty, z: tz, duration, ease: 'power2.inOut', overwrite: 'auto' }, 0)
    },
    snapshot() {
      // Mid-flight, the state worth saving is where the move was going, not an interpolated camera nobody chose.
      if (pending && tl?.isActive()) return pending
      return {
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
      }
    },
    kill() {
      tl?.kill()
      tl = null
      pending = null
      finish()
    },
  }
}
