import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// lib/physics imports nothing from Three or GSAP, so the suite runs with no DOM.
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
  resolve: { alias: { '@lib': fileURLToPath(new URL('./lib', import.meta.url)) } },
})
