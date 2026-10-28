#!/usr/bin/env node
/**
 * Take newer releases of first-party plugins (`autoPublish: true`, `@vibedev-si/` only).
 *
 * The curated list never gains a version on its own for third-party plugins. First-party packages are published from
 * this organisation's own repositories, so a new release may be recorded automatically once it passes every machine
 * check the curated list applies: npm integrity, an installable `dsh.bundle`, an OSI license matching the review,
 * no install scripts, the size policy, and DSH compatibility. Two extra guards keep behaviour changes human-supervised:
 * a release that would reach a new host or start a new program is refused, and the whole list is run through the same
 * pipeline before anything is written. Code review happens in the package's own pull request before it is published.
 *
 * Usage: node scripts/auto-publish.mjs [--catalog plugins.yml] [--apply] [--json]
 * Exit status: 0 when nothing needed to change or the change was written; 1 when a guard refused a release.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import semver from 'semver'
import { parseDocument, stringify } from 'yaml'
import { loadCatalog } from './lib/catalog.mjs'
import { inspectVersion } from './lib/inspection.mjs'
import { fetchPackument } from './lib/npm.mjs'
import { runPipeline } from './lib/pipeline.mjs'

const { values } = parseArgs({
  options: {
    catalog: { type: 'string', default: 'plugins.yml' },
    apply: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
  },
})
const catalogPath = resolve(values.catalog)
const today = new Date().toISOString().slice(0, 10)
const log = (...parts) => { if (!values.json) console.log(...parts) }

function highestVersion(versions) {
  return versions.map(entry => entry.version).sort(semver.compare).at(-1)
}

function reviewPath(name, version) {
  return join('reviews', `${name}@${version}.md`)
}

function reviewDocument(plugin, previous, version, facts) {
  return `# 审核记录 · Review record：\`${plugin.name}@${version}\`

> 第一方插件，由 VibeDev 自动收录：\`${plugin.name}@${version}\` 是 npm 上该包的最新正式版，行为声明沿用
> \`${previous.version}\` 的审核记录，并重新通过了全部机器检查。
> First-party auto-published entry: the newest stable npm release of a package this organisation maintains. The behaviour
> declarations are carried over from \`${previous.version}\` and every machine check ran again.

## 结论 · Verdict

- 结论 · Verdict：**收 · include**（自动收录 · recorded automatically）
- 审核 · Review：VibeDev（自动 · automated），${today}，testedOn ${previous.review.testedOn.join(', ')}
- 沿用 · Carried over：\`${previous.version}\` 的 capabilities、installScripts 与风险提示。
  Capabilities, install scripts and risk notes from \`${previous.version}\`.

## 机器检查 · Machine checks

| 项目 · Item | 值 · Value |
|---|---|
| integrity | \`${facts.integrity}\` |
| 发布 · Published | ${facts.published} |
| 许可证 · License | ${facts.license} |
| bundle | ${facts.bundle ? '✅' : '❌'} |
| DSH 兼容 · DSH compatibility | ${facts.declaresDsh ? `engines.dsh ${facts.enginesDsh}` : 'no declaration; tested on the target DSH'} |
| 安装脚本 · Install scripts | ${facts.installScripts.length > 0 ? facts.installScripts.join(', ') : '无 · none'} |
| 体量 · Size | 解包 · unpacked ${Math.round(facts.unpackedBytes / 1024)} KiB，${facts.fileCount} 个文件 · files |
| 依赖 · Dependencies | ${Object.keys(facts.dependencies).length > 0 ? Object.entries(facts.dependencies).map(([name, range]) => `\`${name}\` ${range}`).join('、') : '无 · none'} |

网络主机与子进程与上一版本一致 · Network hosts and child processes match the previous reviewed version：
${(facts.hosts ? Object.keys(facts.hosts) : []).join(', ') || '—'}
`
}

const { catalog, errors: structureErrors } = loadCatalog(catalogPath)
if (catalog === undefined || structureErrors.length > 0) {
  for (const error of structureErrors) console.error(error)
  process.exit(1)
}

const pending = []
for (const plugin of catalog.plugins.filter(entry => entry.autoPublish === true)) {
  const previous = plugin.versions.reduce((best, entry) => (semver.gt(entry.version, best.version) ? entry : best))
  let packument
  try {
    packument = await fetchPackument(plugin.name, { timeoutMs: 60_000 })
  } catch (failure) {
    console.error(`${plugin.name}: registry read failed: ${failure.message}`)
    process.exit(1)
  }
  const latest = packument?.['dist-tags']?.latest
  if (typeof latest !== 'string' || semver.valid(latest) !== latest || semver.prerelease(latest) !== null) {
    log(`${plugin.name}: no stable latest tag on npm, skipped`)
    continue
  }
  if (!semver.gt(latest, previous.version)) {
    log(`${plugin.name}: up to date at ${previous.version}`)
    continue
  }
  const facts = (await inspectVersion(plugin.name, latest, { target: catalog.target.dsh })).report
  const before = (await inspectVersion(plugin.name, previous.version, { target: catalog.target.dsh, deps: false })).report
  const hostsBefore = new Set(Object.keys(before.hosts ?? {}))
  const newHosts = Object.keys(facts.hosts ?? {}).filter(host => !hostsBefore.has(host))
  const programsBefore = new Set(before.hints?.childProcess ?? [])
  const newPrograms = (facts.hints?.childProcess ?? []).filter(file => !programsBefore.has(file))
  if (newHosts.length > 0 || newPrograms.length > 0) {
    console.error(`${plugin.name}@${latest}: refused, it reaches new hosts (${newHosts.join(', ') || 'none'}) or starts new programs (${newPrograms.join(', ') || 'none'}); review it by hand`)
    process.exitCode = 1
    continue
  }
  pending.push({ plugin, previous, version: latest, facts })
}

if (pending.length === 0) { log('nothing to publish'); process.exit(process.exitCode ?? 0) }

// Prove the whole list, including the new versions, before touching the real file.
const staging = mkdtempSync(join(tmpdir(), 'vd-auto-publish-'))
try {
  const draft = {
    ...catalog,
    plugins: catalog.plugins.map(plugin => {
      const addition = pending.find(entry => entry.plugin.name === plugin.name)
      if (addition === undefined) return plugin
      return {
        ...plugin,
        versions: [...plugin.versions, {
          version: addition.version,
          integrity: addition.facts.integrity,
          review: { ...addition.previous.review, reviewer: 'VibeDev (automated)', date: today },
        }],
      }
    }),
  }
  const draftPath = join(staging, 'plugins.yml')
  writeFileSync(draftPath, stringify(draft, { lineWidth: 0 }))
  const result = await runPipeline(draftPath)
  for (const error of result.errors) console.error(error)
  if (result.errors.length > 0) process.exit(1)
} finally {
  rmSync(staging, { recursive: true, force: true })
}

if (!values.apply) {
  for (const entry of pending) log(`would add ${entry.plugin.name}@${entry.version}`)
  log('dry run; pass --apply to write')
  process.exit(process.exitCode ?? 0)
}

const document = parseDocument(readFileSync(catalogPath, 'utf8'), { uniqueKeys: true })
const plugins = document.get('plugins')
for (const entry of pending) {
  const index = plugins.items.findIndex(item => item.get('name') === entry.plugin.name)
  if (index < 0) throw new Error(`${entry.plugin.name}: missing from ${values.catalog}`)
  const versions = plugins.items[index].get('versions')
  versions.items.push(document.createNode({
    version: entry.version,
    integrity: entry.facts.integrity,
    review: {
      ...entry.previous.review,
      reviewer: 'VibeDev (automated)',
      date: today,
      notes: `Automated first-party release ${entry.version} from ${entry.plugin.name}; capabilities, install scripts and risk notes are unchanged from ${entry.previous.version}.`,
    },
  }))
  const file = reviewPath(entry.plugin.name, entry.version)
  mkdirSync(join('reviews', entry.plugin.name.startsWith('@') ? entry.plugin.name.split('/')[0] : '.'), { recursive: true })
  writeFileSync(file, reviewDocument(entry.plugin, entry.previous, entry.version, entry.facts))
  log(`added ${entry.plugin.name}@${entry.version} and ${file}`)
}
writeFileSync(catalogPath, document.toString())
process.exit(process.exitCode ?? 0)
