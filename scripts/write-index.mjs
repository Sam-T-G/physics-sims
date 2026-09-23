// Writes dist/index.html listing every built app. Run after `pnpm build`.
import { readdirSync, writeFileSync, existsSync } from 'node:fs'
const dist = new URL('../dist/', import.meta.url)
if (!existsSync(dist)) { console.error('dist/ missing; run pnpm build first'); process.exit(1) }
const apps = readdirSync(dist, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort()
const items = apps.map(a => `<li><a href="./${a}/">${a}</a></li>`).join('\n')
writeFileSync(new URL('index.html', dist), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="Interactive 3D simulations for Physics 4B (electricity and magnetism), one per exam section."><title>physics-sims</title><h1>physics-sims</h1><ul>\n${items}\n</ul>\n`)
console.log(`index.html lists ${apps.length} app(s)`)
