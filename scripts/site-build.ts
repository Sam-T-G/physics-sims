// Build-time extras every app's vite.config.ts adds:
// - meta.json: a copy of the app's sim.meta.ts, which scripts/write-index.mjs reads to build the site index.
// - THIRD-PARTY-NOTICES.txt: the license of every package bundled into the app, found from the module graph,
//   plus the OpenStax credit for the physics content. MIT asks for its notice in copies, and the OFL asks for
//   its license to travel with the Nunito font files.
import type { Plugin } from 'vite'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { SimMeta } from '../lib/chrome/types'

export const OPENSTAX_CREDIT = [
  'Physics content (worked examples, problem values, paraphrased explanations and page numbers) comes from',
  'University Physics Volume 2 by William Moebs, Samuel J. Ling and Jeff Sanny, OpenStax:',
  'https://openstax.org/details/books/university-physics-volume-2',
  'Licensed CC BY-NC-SA 4.0: https://creativecommons.org/licenses/by-nc-sa/4.0/',
  'Access for free at openstax.org.',
  'Changes: book values rebuilt as interactive presets, text paraphrased.',
].join('\n')

/** The node_modules package an id comes from, as { name, dir }, or null for project files. */
export function packageOf(id: string): { name: string; dir: string } | null {
  const clean = id.replace(/^\0/, '').split('?')[0]!.replace(/\\/g, '/')
  const marker = '/node_modules/'
  const at = clean.lastIndexOf(marker)
  if (at < 0) return null
  const rest = clean.slice(at + marker.length).split('/')
  const name = rest[0]?.startsWith('@') ? `${rest[0]}/${rest[1] ?? ''}` : rest[0]
  if (!name || name.startsWith('.') || name.endsWith('/')) return null
  return { name, dir: clean.slice(0, at + marker.length) + name }
}

function noticeFor(dir: string): string {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name: string; version?: string; license?: string }
  const file = readdirSync(dir).find(f => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f))
  const head = `${pkg.name} ${pkg.version ?? ''}\nLicense: ${pkg.license ?? 'see the package'}`.trim()
  return file ? `${head}\n\n${readFileSync(join(dir, file), 'utf8').trim()}` : head
}

export function siteFiles(meta: SimMeta): Plugin {
  return {
    name: 'physics-sims-site-files',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'meta.json', source: JSON.stringify(meta, null, 2) + '\n' })
      const pkgs = new Map<string, string>()
      for (const id of this.getModuleIds()) {
        const p = packageOf(id)
        if (p && !pkgs.has(p.name) && existsSync(join(p.dir, 'package.json'))) pkgs.set(p.name, p.dir)
      }
      const rule = '-'.repeat(72)
      const body = [...pkgs.keys()].sort().map(name => noticeFor(pkgs.get(name)!))
      const text = [
        `${meta.title}: third-party notices`,
        '',
        OPENSTAX_CREDIT,
        '',
        'Code and fonts bundled into this app, each with its license:',
        ...body.flatMap(b => [rule, b]),
        '',
      ].join('\n')
      this.emitFile({ type: 'asset', fileName: 'THIRD-PARTY-NOTICES.txt', source: text })
    },
  }
}
