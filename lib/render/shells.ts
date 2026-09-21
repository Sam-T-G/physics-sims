import * as THREE from 'three'

/**
 * Concentric translucent spheres. One shared unit geometry, each shell scaled to its radius, explicit
 * renderOrder inner to outer (Three sorts transparent objects by origin distance, and these share one).
 */
export type Shells = {
  group: THREE.Group
  meshes: THREE.Mesh[]
  setRadius(i: number, r: number): void
  dispose(): void
}

export function createShells(radii: readonly number[], opts: { color: string; opacity: number }): Shells {
  const geometry = new THREE.SphereGeometry(1, 48, 32)
  const group = new THREE.Group()
  const meshes = radii.map((r, i) => {
    const material = new THREE.MeshStandardMaterial({
      color: opts.color,
      transparent: true,
      opacity: opts.opacity,
      depthWrite: false,
      side: THREE.FrontSide,
      roughness: 0.4,
      metalness: 0,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.scale.setScalar(r)
    mesh.renderOrder = 1 + i
    group.add(mesh)
    return mesh
  })
  return {
    group,
    meshes,
    setRadius(i, r) {
      meshes[i]?.scale.setScalar(r)
    },
    dispose() {
      geometry.dispose()
      for (const m of meshes) (m.material as THREE.Material).dispose()
    },
  }
}
