import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { siteFiles } from '../../scripts/site-build'
import { meta } from './src/sim.meta'

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// base './' keeps every asset path relative, so the same build works at
// https://sam-t-g.github.io/physics-sims/03-magnetism/ and nested under a hub.
export default defineConfig({
  root: here('.'),
  base: './',
  build: { outDir: here('../../dist/03-magnetism'), emptyOutDir: true, rolldownOptions: { output: { comments: { legal: true } } } },
  plugins: [siteFiles(meta)],
  resolve: { alias: { '@lib': here('../../lib') } },
})
