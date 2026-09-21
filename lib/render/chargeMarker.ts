import * as THREE from 'three'

export type ChargeSign = 1 | -1

/** A charge drawn as a colored sphere with a + or − glyph, so sign is never carried by color alone. */
export type ChargeMarker = {
  object: THREE.Group
  setSign(sign: ChargeSign): void
  setPosition(x: number, y: number, z: number): void
}

export type ChargeMarkerFactory = {
  make(sign: ChargeSign, radius?: number): ChargeMarker
  /** Frees the shared geometry and the two glyph textures. Call once at unmount. */
  dispose(): void
}

function glyphTexture(doc: Document, text: string): THREE.CanvasTexture {
  const size = 128
  const canvas = doc.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const g = canvas.getContext('2d')!
  g.clearRect(0, 0, size, size)
  g.fillStyle = '#ffffff'
  g.font = `bold ${size * 0.8}px system-ui, sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, size / 2, size / 2 + size * 0.02)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * Shares one sphere geometry and two glyph textures across every marker it makes. The glyphs are drawn on
 * a canvas from the document the app passes in, so this module holds no reference to a global document.
 */
export function createChargeMarkers(colors: { pos: string; neg: string }, doc: Document): ChargeMarkerFactory {
  const geometry = new THREE.SphereGeometry(1, 32, 24)
  const plus = glyphTexture(doc, '+')
  const minus = glyphTexture(doc, '−')
  const materials: THREE.Material[] = []
  return {
    make(sign, radius = 0.08) {
      const material = new THREE.MeshStandardMaterial({ color: sign > 0 ? colors.pos : colors.neg, roughness: 0.35, metalness: 0 })
      const spriteMaterial = new THREE.SpriteMaterial({ map: sign > 0 ? plus : minus, depthTest: false, transparent: true })
      materials.push(material, spriteMaterial)
      const sphere = new THREE.Mesh(geometry, material)
      sphere.scale.setScalar(radius)
      const sprite = new THREE.Sprite(spriteMaterial)
      sprite.scale.setScalar(radius * 1.6)
      sprite.renderOrder = 20
      const object = new THREE.Group()
      object.add(sphere, sprite)
      return {
        object,
        setSign(s) {
          material.color.set(s > 0 ? colors.pos : colors.neg)
          spriteMaterial.map = s > 0 ? plus : minus
          spriteMaterial.needsUpdate = true
        },
        setPosition(x, y, z) {
          object.position.set(x, y, z)
        },
      }
    },
    dispose() {
      geometry.dispose()
      plus.dispose()
      minus.dispose()
      for (const m of materials) m.dispose()
    },
  }
}
