#!/usr/bin/env node
/**
 * Build the published directory from the curated list: `index.json` (DSH plugin market index format 1), `icons/`
 * for icons too large to inline, and a small human-readable `index.html`. Nothing is written when validation fails.
 *
 * Usage: node scripts/build.mjs [--catalog plugins.yml] [--out dist]
 */
import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { GENERATED_ICON } from './lib/display.mjs'
import { writeIfChanged } from './lib/package-files.mjs'
import { runPipeline } from './lib/pipeline.mjs'
import { printReport } from './lib/report.mjs'

const { values } = parseArgs({ options: { catalog: { type: 'string', default: 'plugins.yml' }, out: { type: 'string', default: 'dist' } } })
const result = await runPipeline(resolve(values.catalog))
printReport(result, `build ${values.catalog}`)
if (result.index === undefined) process.exit(1)

const out = resolve(values.out)
for (const [path, bytes] of result.icons) writeIfChanged(join(out, path), bytes)
const iconDir = join(out, 'icons')
for (const name of existsSync(iconDir) ? readdirSync(iconDir) : []) {
  const file = join(iconDir, name)
  if (GENERATED_ICON.test(name) && !result.icons.has(`icons/${name}`) && lstatSync(file).isFile()) rmSync(file)
}
const changed = writeIfChanged(join(out, 'index.json'), `${JSON.stringify(result.index, null, 2)}\n`)
writeIfChanged(join(out, 'index.html'), page(result.index, result.catalog))
console.log(`${changed ? 'wrote' : 'unchanged'} ${join(out, 'index.json')}: ${result.index.plugins.length} plugin(s)`)

function escape(text) {
  return String(text).replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
}

function textOf(value, language) {
  return typeof value === 'string' ? value : value?.[language] ?? value?.en ?? ''
}

function page(index, catalog) {
  const rows = index.plugins.map(plugin => {
    const versions = plugin.versions.map(version => escape(version.version)).join(', ')
    return `<tr><td><code>${escape(plugin.name)}</code></td><td>${escape(textOf(plugin.title, 'zh') || plugin.name)}</td><td>${versions}</td><td>${escape(plugin.metadata.category)}</td></tr>`
  }).join('\n')
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(textOf(index.title, 'zh'))}</title>
<style>body{font:15px/1.6 system-ui,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:.4rem;text-align:left}code{font-size:90%}</style></head>
<body>
<h1>${escape(textOf(index.title, 'zh'))} / ${escape(textOf(index.title, 'en'))}</h1>
<p>${escape(textOf(index.description, 'zh'))}</p>
<p>${escape(textOf(index.description, 'en'))}</p>
<p>索引文件 / Index file: <a href="index.json"><code>index.json</code></a> · DSH plugin market index format 1 · target DSH <code>${escape(catalog.target.dsh)}</code></p>
<p>在 VibeDev 中打开 插件 → 发现 浏览和安装。/ Browse and install from Plugins → Discover in VibeDev.</p>
<table><thead><tr><th>Package</th><th>Title</th><th>Reviewed versions</th><th>Category</th></tr></thead>
<tbody>
${rows || '<tr><td colspan="4">尚未收录插件 / No plugins listed yet</td></tr>'}
</tbody></table>
<p><a href="https://github.com/VibeDev-Si/vibedev-plugin-index">Source and review records</a></p>
</body></html>
`
}
