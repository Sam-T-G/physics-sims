import * as THREE from 'three'

/**
 * A slice plane of fixed-length arrows drawn as one InstancedMesh. Length is fixed; magnitude is carried by
 * color on a labeled log scale; the caller lerps in sRGB to match the HTML legend and converts once. Singular samples are
 * hidden with a zero-scale matrix. Allocated once at maxCount; refill sets each instance in place.
 */
export type ArrowField = {
  mesh: THREE.InstancedMesh
  /** Write instance i: position, unit direction, and a color in linear working space. */
  setInstance(i: number, pos: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, color: THREE.Color): void
  hideInstance(i: number): void
  /** Call after a batch of setInstance/hideInstance. count is the number of live instances. */
  commit(count: number): void
  dispose(): void
}

const UP = new THREE.Vector3(0, 1, 0)

export function createArrowField(maxCount: number, opts: { length: number; radius: number }): ArrowField {
  const shaft = new THREE.CylinderGeometry(opts.radius, opts.radius, opts.length * 0.7, 8, 1)
  shaft.translate(0, opts.length * 0.35 - opts.length / 2, 0)
  const head = new THREE.ConeGeometry(opts.radius * 2.6, opts.length * 0.3, 10, 1)
  head.translate(0, opts.length * 0.7 - opts.length / 2 + opts.length * 0.15, 0)
  // Merge the two into one geometry so one instance is one arrow, centered on its sample point.
  const geometry = mergeGeometries(shaft, head)
  shaft.dispose()
  head.dispose()
  const material = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0 })
  const mesh = new THREE.InstancedMesh(geometry, material, maxCount)
  mesh.frustumCulled = false
  mesh.count = 0
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const p = new THREE.Vector3()
  const s = new THREE.Vector3(1, 1, 1)
  const zero = new THREE.Vector3(0, 0, 0)
  const d = new THREE.Vector3()
  return {
    mesh,
    setInstance(i, pos, dir, color) {
      d.set(dir.x, dir.y, dir.z).normalize()
      q.setFromUnitVectors(UP, d)
      p.set(pos.x, pos.y, pos.z)
      m.compose(p, q, s)
      mesh.setMatrixAt(i, m)
      mesh.setColorAt(i, color)
    },
    hideInstance(i) {
      m.compose(zero, q.identity(), zero)
      mesh.setMatrixAt(i, m)
    },
    commit(count) {
      mesh.count = count
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    },
    dispose() {
      geometry.dispose()
      material.dispose()
      mesh.dispose()
    },
  }
}

/** Minimal non-indexed merge of two geometries with position and normal attributes. */
function mergeGeometries(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const na = a.toNonIndexed()
  const nb = b.toNonIndexed()
  const pa = na.getAttribute('position') as THREE.BufferAttribute
  const pb = nb.getAttribute('position') as THREE.BufferAttribute
  const nna = na.getAttribute('normal') as THREE.BufferAttribute
  const nnb = nb.getAttribute('normal') as THREE.BufferAttribute
  const positions = new Float32Array(pa.array.length + pb.array.length)
  positions.set(pa.array as Float32Array, 0)
  positions.set(pb.array as Float32Array, pa.array.length)
  const normals = new Float32Array(nna.array.length + nnb.array.length)
  normals.set(nna.array as Float32Array, 0)
  normals.set(nnb.array as Float32Array, nna.array.length)
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  na.dispose()
  nb.dispose()
  return out
}
