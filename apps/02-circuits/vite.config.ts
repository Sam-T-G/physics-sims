import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { siteFiles } from '../../scripts/site-build'
import { meta } from './src/sim.meta'

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// base './' keeps every asset path relative, so the same build works at
// https://sam-t-g.github.io/physics-sims/02-circuits/ and nested under a hub.
export default defineConfig({
  root: here('.'),
  base: './',
  // comments.legal keeps the @license headers (three.js and others) in the minified bundle.
  build: { outDir: here('../../dist/02-circuits'), emptyOutDir: true, rolldownOptions: { output: { comments: { legal: true } } } },
  plugins: [siteFiles(meta)],
  resolve: { alias: { '@lib': here('../../lib') } },
})
