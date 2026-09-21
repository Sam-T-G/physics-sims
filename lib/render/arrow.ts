import * as THREE from 'three'

/**
 * One arrow glyph: a cylinder shaft and a cone head sharing one material, pointing along +y in its own
 * frame. set(from, to) places it in world space; setLength/setColor change it in place. Allocate once.
 */
export type Arrow = {
  object: THREE.Group
  set(from: THREE.Vector3 | { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): void
  /** Place by origin, unit direction and length. */
  setDirection(origin: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, length: number): void
  setColor(color: string): void
  setVisible(on: boolean): void
}

export type ArrowFactory = {
  make(color: string, radius?: number): Arrow
  dispose(): void
}

const UP = new THREE.Vector3(0, 1, 0)

/** Shares the shaft and head geometries across every arrow it makes. */
export function createArrows(): ArrowFactory {
  const shaftGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1)
  shaftGeo.translate(0, 0.5, 0)
  const headGeo = new THREE.ConeGeometry(1, 1, 16, 1)
  headGeo.translate(0, 0.5, 0)
  const materials: THREE.Material[] = []
  const tmpDir = new THREE.Vector3()
  const tmpFrom = new THREE.Vector3()
  const tmpQuat = new THREE.Quaternion()
  return {
    make(color, radius = 0.02) {
      const material = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0 })
      materials.push(material)
      const shaft = new THREE.Mesh(shaftGeo, material)
      const head = new THREE.Mesh(headGeo, material)
      const object = new THREE.Group()
      object.add(shaft, head)
      const place = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, length: number) => {
        tmpDir.set(dx, dy, dz)
        if (tmpDir.lengthSq() === 0 || length <= 0) {
          object.visible = false
          return
        }
        object.visible = true
        tmpDir.normalize()
        object.position.set(ox, oy, oz)
        tmpQuat.setFromUnitVectors(UP, tmpDir)
        object.quaternion.copy(tmpQuat)
        const headLen = Math.min(0.12, length * 0.35)
        const headR = radius * 2.6
        shaft.scale.set(radius, Math.max(0, length - headLen), radius)
        head.position.set(0, Math.max(0, length - headLen), 0)
        head.scale.set(headR, headLen, headR)
      }
      return {
        object,
        set(from, to) {
          tmpFrom.set(from.x, from.y, from.z)
          const dx = to.x - from.x
          const dy = to.y - from.y
          const dz = to.z - from.z
          place(from.x, from.y, from.z, dx, dy, dz, Math.sqrt(dx * dx + dy * dy + dz * dz))
        },
        setDirection(origin, dir, length) {
          place(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, length)
        },
        setColor(c) {
          material.color.set(c)
        },
        setVisible(on) {
          object.visible = on
        },
      }
    },
    dispose() {
      shaftGeo.dispose()
      headGeo.dispose()
      for (const m of materials) m.dispose()
    },
  }
}
