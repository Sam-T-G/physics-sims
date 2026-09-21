import * as THREE from 'three'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import type { FieldLine } from '@lib/physics'

/**
 * Every field line packed into one fat-line geometry as start/end pairs. Allocated once at maxSegments;
 * each set() writes into the interleaved buffer and sets instanceCount. Plain THREE.Line ignores
 * linewidth on WebGL, hence LineSegments2. Three r186 sets the material resolution itself in
 * onBeforeRender (device pixels), so linewidth is in device pixels and is scaled by the pixel ratio here.
 */
export type FieldLines = {
  object: LineSegments2
  /** Replace every line. Segments beyond maxSegments are dropped and the count returned says how many drew. */
  set(lines: readonly FieldLine[]): number
  setPixelRatio(ratio: number): void
  setColor(color: string): void
  dispose(): void
}

export function createFieldLines(maxSegments: number, opts: { color: string; width: number; opacity?: number }): FieldLines {
  const geometry = new LineSegmentsGeometry()
  const scratch = new Float32Array(maxSegments * 6)
  geometry.setPositions(scratch)
  const material = new LineMaterial({
    color: new THREE.Color(opts.color).getHex(),
    linewidth: opts.width,
    worldUnits: false,
    transparent: true,
    opacity: opts.opacity ?? 0.75,
    depthWrite: false,
  })
  const object = new LineSegments2(geometry, material)
  object.frustumCulled = false
  object.renderOrder = 5
  geometry.instanceCount = 0
  const buffer = (geometry.attributes['instanceStart'] as THREE.InterleavedBufferAttribute).data as THREE.InstancedInterleavedBuffer

  return {
    object,
    set(lines) {
      const arr = buffer.array as Float32Array
      let seg = 0
      outer: for (const line of lines) {
        const pts = line.points
        for (let k = 0; k + 1 < pts.length; k++) {
          if (seg >= maxSegments) break outer
          const a = pts[k]!
          const b = pts[k + 1]!
          const o = 6 * seg
          arr[o] = a.x
          arr[o + 1] = a.y
          arr[o + 2] = a.z
          arr[o + 3] = b.x
          arr[o + 4] = b.y
          arr[o + 5] = b.z
          seg++
        }
      }
      buffer.needsUpdate = true
      geometry.instanceCount = seg
      return seg
    },
    setPixelRatio(ratio) {
      material.linewidth = opts.width * ratio
    },
    setColor(color) {
      material.color.set(color)
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
