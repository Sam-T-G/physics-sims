import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// base './' keeps every asset path relative, so the same build works at
// https://sam-t-g.github.io/physics-sims/02-circuits/ and nested under a hub.
export default defineConfig({
  root: here('.'),
  base: './',
  build: { outDir: here('../../dist/02-circuits'), emptyOutDir: true },
  resolve: { alias: { '@lib': here('../../lib') } },
})
