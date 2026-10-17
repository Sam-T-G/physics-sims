// Writes dist/index.html: one card per built app, from the meta.json each app's build emits
// (scripts/site-build.ts). Run after `pnpm build`. Optional argument: the dist folder.
import { readdirSync, writeFileSync, existsSync, readFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const dist = process.argv[2] ? pathToFileURL(resolve(process.argv[2]) + '/') : new URL('../dist/', import.meta.url)
if (!existsSync(dist)) { console.error('dist/ missing; run pnpm build first'); process.exit(1) }

// Exam per section, from the course syllabus (syllabus.md in Physics-4B).
const EXAM = { electrostatics: 'Exam 1', electrodynamics: 'Exam 2', 'magnetism and induction': 'Exam 3', 'ac circuits and electromagnetic waves': 'Exam 4' }
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const apps = readdirSync(dist, { withFileTypes: true }).filter(d => d.isDirectory() && d.name !== 'fonts').map(d => d.name).sort()
const metas = apps.map(dir => {
  const file = new URL(`${dir}/meta.json`, dist)
  let meta = null
  try { meta = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null } catch { meta = null }
  return { dir, meta, notices: existsSync(new URL(`${dir}/THIRD-PARTY-NOTICES.txt`, dist)) }
})

const card = ({ dir, meta }) => {
  if (!meta) return `<li><a class="card" href="./${esc(dir)}/"><h2>${esc(dir)}</h2></a></li>`
  const exam = EXAM[String(meta.section).toLowerCase()]
  const chapters = String(meta.chapters).replace(/^OpenStax University Physics Vol 2, /, 'OpenStax ')
  const line = [exam, meta.section, chapters].filter(Boolean).map(esc).join(' · ')
  return `<li><a class="card" href="./${esc(dir)}/"><h2>${esc(meta.title)}</h2><p class="meta">${line}</p><p class="concept">${esc(meta.concept)}</p></a></li>`
}

// The sims' font, copied next to the page with its license (the OFL asks for the license to travel with the font).
const fontDir = new URL('../node_modules/@fontsource-variable/nunito/', import.meta.url)
const fontFile = new URL('files/nunito-latin-wght-normal.woff2', fontDir)
const hasFont = existsSync(fontFile)
if (hasFont) {
  mkdirSync(new URL('fonts/', dist), { recursive: true })
  copyFileSync(fontFile, new URL('fonts/nunito-latin-wght-normal.woff2', dist))
  if (existsSync(new URL('LICENSE', fontDir))) copyFileSync(new URL('LICENSE', fontDir), new URL('fonts/OFL.txt', dist))
}

const noticeLinks = metas.filter(m => m.notices).map(m => `<a href="./${esc(m.dir)}/THIRD-PARTY-NOTICES.txt">${esc(m.meta?.title ?? m.dir)}</a>`)
const favicon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='4' y='10' width='24' height='12' rx='6' fill='%23ffe6c9'/%3E%3Crect x='11' y='10' width='3' height='12' fill='%237467c2'/%3E%3Crect x='18' y='10' width='3' height='12' fill='%23ff8fa3'/%3E%3C/svg%3E"

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Physics 4B sims</title>
<meta name="description" content="Interactive sims for Physics 4B (electricity and magnetism), built on OpenStax University Physics Vol 2. Works on your phone.">
<meta name="theme-color" content="#e9e7ff">
<link rel="icon" href="${favicon}">
<style>
${hasFont ? `@font-face { font-family: 'Nunito Variable'; font-style: normal; font-display: swap; font-weight: 200 1000; src: url(./fonts/nunito-latin-wght-normal.woff2) format('woff2-variations'); }\n` : ''}:root {
  color-scheme: light;
  --sky: #e9e7ff; --sky-2: #f7eaf5; --paper: #fffdfb; --ink: #3a3358; --ink-2: #625a82;
  --grape: #7467c2; --grape-deep: #5a4daa; --butter: #ffd15c;
  --shadow: 0 1px 0 rgba(255, 255, 255, 0.9) inset, 0 8px 24px -10px rgba(74, 58, 140, 0.35);
  --font: 'Nunito Variable', ui-rounded, 'SF Pro Rounded', system-ui, sans-serif;
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body { min-height: 100vh; background: linear-gradient(180deg, var(--sky), var(--sky-2)); color: var(--ink); font-family: var(--font); font-size: 1.0625rem; line-height: 1.5; }
main { max-width: 760px; margin: 0 auto; padding: 48px 16px 32px; }
h1 { margin: 0; font-size: clamp(2rem, 6vw, 2.75rem); font-weight: 900; line-height: 1.1; color: var(--grape-deep); }
.lede { margin: 8px 0 0; color: var(--ink-2); font-weight: 700; }
ul { list-style: none; margin: 32px 0 0; padding: 0; display: grid; gap: 16px; }
.card { display: block; padding: 20px 22px; border-radius: 26px; background: var(--paper); box-shadow: var(--shadow); color: inherit; text-decoration: none; transition: transform 160ms cubic-bezier(0.34, 1.56, 0.64, 1); }
.card:hover { transform: translateY(-2px); }
.card:focus-visible { outline: 3px solid var(--grape); outline-offset: 3px; }
.card h2 { margin: 0; font-size: 1.375rem; font-weight: 900; color: var(--grape-deep); }
.meta { margin: 4px 0 0; font-size: 0.875rem; font-weight: 800; color: var(--ink-2); }
.concept { margin: 10px 0 0; }
footer { margin-top: 40px; font-size: 0.875rem; color: var(--ink-2); }
footer p { margin: 0 0 8px; }
footer a { color: var(--grape-deep); font-weight: 700; text-decoration-thickness: 1.5px; text-underline-offset: 2px; }
footer a:focus-visible { outline: 3px solid var(--grape); outline-offset: 2px; border-radius: 4px; }
@media (prefers-reduced-motion: reduce) { .card { transition: none; } .card:hover { transform: none; } }
</style>
</head>
<body>
<main>
<h1>Physics 4B sims</h1>
<p class="lede">An honors project at RCC, Fall 2026. Interactive sims for Physics 4B, added one at a time through the semester. Every sim works on your phone.</p>
<ul>
${metas.map(card).join('\n')}
</ul>
<footer>
<p>Physics, worked examples and page numbers: <a href="https://openstax.org/details/books/university-physics-volume-2">University Physics Volume 2</a> by William Moebs, Samuel J. Ling and Jeff Sanny, OpenStax. License: <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</a>. Access for free at openstax.org.</p>
${noticeLinks.length ? `<p>Open-source code and fonts in each sim, with their licenses: ${noticeLinks.join(', ')}.</p>\n` : ''}</footer>
</main>
</body>
</html>
`
writeFileSync(new URL('index.html', dist), html)
console.log(`index.html lists ${apps.length} app(s)${metas.some(m => !m.meta) ? ' (some without meta.json)' : ''}`)
