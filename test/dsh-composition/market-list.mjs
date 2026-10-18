#!/usr/bin/env node
/**
 * Real-composition check against a built DSH checkout: serve a built index directory on http://127.0.0.1, boot the
 * DSH Loader (`boot()` of @deepseek-ai/dsh-app-boot) with a temporary DSH_HOME and profile whose bundle mounts the
 * real config-editor, settings, plugin-manager, and plugin-market services with `indexes` set to that URL, and print
 * what the market reads. It follows packages/boot/plugin-market/tests/configuration.spec.ts, with the real
 * plugin-manager instead of a stub. Nothing is installed; the temporary home is deleted afterwards.
 *
 * Usage: node test/dsh-composition/market-list.mjs --dsh <DSH checkout with build artifacts> [--dist .cache/e2e-dist]
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { dsh: { type: 'string' }, dist: { type: 'string', default: '.cache/e2e-dist' } } })
if (values.dsh === undefined) {
  console.error('usage: node test/dsh-composition/market-list.mjs --dsh <DSH checkout> [--dist <built index dir>]')
  process.exit(2)
}
const checkout = resolve(values.dsh)
const dist = resolve(values.dist)
const load = async path => await import(pathToFileURL(join(checkout, path)).href)
const appBoot = await load('packages/boot/app-boot/lib/index.js')
const ConfigEditor = (await load('packages/boot/config-editor/lib/index.js')).default
const Settings = (await load('packages/settings/settings/lib/index.js')).default
const PluginManager = (await load('packages/boot/plugin-manager/lib/index.js')).default
const PluginMarket = (await load('packages/boot/plugin-market/lib/index.js')).default

const TYPES = { '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.html': 'text/html; charset=utf-8' }
const served = []
const server = createServer((request, response) => {
  const path = resolve(join(dist, decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)))
  const ok = path.startsWith(dist + sep) && existsSync(path) && statSync(path).isFile()
  served.push(`${request.method} ${request.url} accept=${request.headers.accept} -> ${ok ? 200 : 404}`)
  if (!ok) { response.writeHead(404).end(); return }
  response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(readFileSync(path))
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const url = `http://127.0.0.1:${server.address().port}/index.json`

const home = realpathSync(mkdtempSync(join(tmpdir(), 'vibedev-index-dsh-home-')))
process.env.DSH_HOME = home
let ctx
try {
  const dir = join(home, 'profiles', 'index-check')
  appBoot.initProfile(dir, ['index-check-bundle'])
  const bundle = join(dir, 'node_modules', 'index-check-bundle')
  mkdirSync(bundle, { recursive: true })
  writeFileSync(join(home, 'package.json'), '{"name":"index-check-installation"}\n')
  writeFileSync(join(bundle, 'package.json'), JSON.stringify({ name: 'index-check-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  writeFileSync(join(bundle, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: config-editor',
    '      name: cordis:editor',
    '    - id: settings',
    '      name: cordis:settings',
    '    - id: plugin-manager',
    '      name: cordis:manager',
    '      config:',
    '        registry: https://registry.npmjs.org/',
    '    - id: plugin-market',
    '      name: cordis:market',
    '      config:',
    '        indexes:',
    `          - ${url}`,
    '',
  ].join('\n'))
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  const profile = {
    name: 'index-check', startedBundles: ['index-check-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined,
  }
  ctx = await appBoot.boot('index-check', join(dir, 'cordis.yml'), appBoot.readProfilePatches('index-check', profile), (root) => {
    root.provide('profileContext', profile)
    Object.assign(root.loader.builtins, { editor: ConfigEditor, settings: Settings, manager: PluginManager, market: PluginMarket })
  })
  const market = ctx.get('pluginMarket')
  const before = market.listIndexes()
  const page = await market.search(url, { sort: { kind: 'index' }, offset: 0, limit: 10 })
  const byText = await market.search(url, { text: '上下文', sort: { kind: 'relevance' }, offset: 0, limit: 10 })
  const byLabel = await market.search(url, { labels: ['network'], sort: { kind: 'index' }, offset: 0, limit: 10 })
  const entry = await market.entry(url, 'dsh-context')
  const short = text => (typeof text === 'string' && text.length > 72 ? `${text.slice(0, 72)}…` : text)
  console.log(JSON.stringify({
    dshRuntimeVersion: appBoot.getDshRuntimeVersion(),
    dshHome: home,
    pluginManagerBundles: (await ctx.pluginManager.listBundles()).map(item => `${item.name}@${item.version ?? '?'} installed=${item.installed}`),
    listIndexesBeforeRead: before,
    search: {
      title: page.title, total: page.total, nextOffset: page.nextOffset, categories: Object.keys(page.metadata.categories), labels: Object.keys(page.metadata.labels),
      entries: page.entries.map(item => ({
        name: item.name, title: item.title, author: item.author, category: item.metadata.category, labels: item.metadata.labels,
        icon: short(item.icon), defaultVersion: item.defaultVersion, installation: item.installation,
        versions: item.versions.map(version => ({ version: version.version, engines: version.engines.dsh, compatibility: version.compatibility, install: version.install })),
      })),
    },
    textSearch上下文: byText.entries.map(item => item.name),
    labelFilterNetwork: byLabel.entries.map(item => item.name),
    entryDshContextVersions: entry?.versions.map(version => `${version.version} compatible=${version.compatibility.compatible} spec=${version.install.spec}`),
    listIndexesAfterRead: market.listIndexes(),
    served,
  }, null, 2))
} finally {
  try { await ctx?.fiber.dispose() } finally {
    server.close()
    rmSync(home, { recursive: true, force: true })
  }
}
