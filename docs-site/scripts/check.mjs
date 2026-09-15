import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { pages } from '../.vitepress/pages.mjs'
const site = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(site, 'content')
const allowed = new Set(pages)
function walk(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(resolve(dir, e.name)) : [resolve(dir, e.name)]) }
for (const file of walk(root)) {
  const path = relative(root, file).replaceAll('\\', '/')
  assert(['public/favicon.svg', 'public/favicon.ico'].includes(path) || allowed.has(path) || (path.startsWith('public/raw/') && allowed.has(path.slice(11))), `Unexpected content file: ${path}`)
}
const sensitive = [ /sk-[a-zA-Z0-9_-]{20,}/, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /eyJ[a-zA-Z0-9_-]{15,}\.[a-zA-Z0-9_-]{15,}\.[a-zA-Z0-9_-]{15,}/, /(?:password|access_token|refresh_token|api_key)\s*[:=]\s*["'][^"'\s]{12,}["']/i ]
for (const page of pages) {
  const text = readFileSync(resolve(root, page), 'utf8')
  assert(!text.includes('\uFFFD'), `Invalid UTF-8: ${page}`)
  assert(/^# /m.test(text), `Missing title: ${page}`)
  assert(!sensitive.some(p => p.test(text)), `Possible credential in ${page}`)
  for (const match of text.matchAll(/\]\((\/[^)#\s]*)(?:#[^)]*)?\)/g)) {
    const target = match[1].slice(1) || 'index'
    assert(allowed.has(target + '.md'), `Broken link in ${page}: ${target}`)
  }
}
const dist = resolve(site, '.vitepress/dist')
if (existsSync(dist)) {
  for (const page of pages) {
    assert(existsSync(resolve(dist, page.replace(/\.md$/, '.html'))), `Missing HTML: ${page}`)
    assert.deepEqual(readFileSync(resolve(root, page)), readFileSync(resolve(dist, 'raw', page)), `Stale download: ${page}`)
  }
  for (const file of walk(dist)) {
    if (/\.(?:html|md|js|json)$/.test(file)) {
      const text = readFileSync(file, 'utf8')
      assert(!sensitive.some(p => p.test(text)), `Possible credential in build: ${relative(dist,file)}`)
    }
    assert(!/(?:config\.ya?ml|auth\.json|登录信息\.txt|\.log)$/.test(file), 'Private file in build')
  }
}
console.log(`PASS: ${pages.length} approved pages; internal links, content boundary, credential patterns${existsSync(dist) ? ', built pages and exact source downloads' : ''}.`)
