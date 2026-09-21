import * as THREE from 'three'
import type { TriMesh } from '@lib/physics'

/**
 * A closed surface drawn from a layer-1 TriMesh. Render holds a NON-indexed copy (three vertices per
 * face) with per-vertex color, refilled in place through the index; flat shading derives normals in
 * the shader. Allocated once at the maximum face count; refill sets the draw range.
 */
export type SurfaceMesh = {
  mesh: THREE.Mesh
  /** Copy positions from tri (faceCount ≤ maxFaces) and color each face; color defaults to the base color. */
  refill(tri: TriMesh, colorOf?: (face: number, out: THREE.Color) => void): void
  setOpacity(opacity: number): void
  dispose(): void
}

export function createSurfaceMesh(maxFaces: number, opts: { color: string; opacity: number }): SurfaceMesh {
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(maxFaces * 9)
  const colors = new Float32Array(maxFaces * 9)
  const posAttr = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage)
  const colAttr = new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('position', posAttr)
  geometry.setAttribute('color', colAttr)
  geometry.setDrawRange(0, 0)
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    transparent: true,
    opacity: opts.opacity,
    depthWrite: false,
    side: THREE.DoubleSide, // an open bowl is seen from inside; a closed surface shows its far wall through the near one
    roughness: 0.55,
    metalness: 0,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.renderOrder = 10
  const base = new THREE.Color(opts.color)
  const tmp = new THREE.Color()

  return {
    mesh,
    refill(tri, colorOf) {
      const faces = Math.min(tri.faceCount, maxFaces)
      const P = tri.positions
      const I = tri.index
      for (let f = 0; f < faces; f++) {
        if (colorOf) colorOf(f, tmp)
        else tmp.copy(base)
        for (let k = 0; k < 3; k++) {
          const v = 3 * I[3 * f + k]!
          const o = 9 * f + 3 * k
          positions[o] = P[v]!
          positions[o + 1] = P[v + 1]!
          positions[o + 2] = P[v + 2]!
          colors[o] = tmp.r
          colors[o + 1] = tmp.g
          colors[o + 2] = tmp.b
        }
      }
      posAttr.needsUpdate = true
      colAttr.needsUpdate = true
      geometry.setDrawRange(0, faces * 3)
    },
    setOpacity(opacity) {
      material.opacity = opacity
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
