/**
 * Review records: turn static inspection facts and an install-trial log into a Markdown record (Chinese first, then
 * English, label by label), a machine-readable facts file, a comparison with a previous version, and a draft
 * plugins.yml entry in which only judgment fields stay TODO. Pure functions; review.mjs does the I/O.
 */
import { HINT_LABELS } from './inspection.mjs'

export const FACTS_SCHEMA = 1

// ---- formatting helpers ------------------------------------------------------------------------------------------

const cell = value => String(value ?? '—').replaceAll('|', '\\|').replace(/\s*\n\s*/gu, ' ') || '—'
const code = value => `\`${String(value).replaceAll('`', "'")}\``
const kib = bytes => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MiB` : `${Math.round(bytes / 1024)} KiB`)
const yes = value => (value ? '✅' : '❌')

/** A short list for a table cell: the first items, then how many more. */
function list(items, max = 6, wrap = code) {
  if (items === undefined || items.length === 0) return '—'
  return [...items.slice(0, max).map(wrap), ...items.length > max ? [`… +${items.length - max}`] : []].join(', ')
}

function table(header, rows) {
  return [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`, ...rows.map(row => `| ${row.map(cell).join(' | ')} |`)].join('\n')
}

const unique = items => [...new Set(items)]

/** Counted, ordered entries: `a ×3`. */
function counted(items) {
  const counts = new Map()
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1)
  return [...counts].map(([item, count]) => (count > 1 ? `${item} ×${count}` : item))
}

// ---- install trial -----------------------------------------------------------------------------------------------

/** How a reviewer reads a trial phase: install (hot install and first activation), a call, or the restart. */
function groupOf(phase) {
  if (phase.startsWith('install:') || phase === 'states1') return 'install'
  if (phase.startsWith('call:')) return phase.slice('call:'.length)
  if (phase === 'boot2' || phase === 'idle2' || phase === 'states2') return 'restart'
  return null
}

const isPackageManagerRun = spawn => spawn.args.some(arg => /pnpm\.[cm]?js$/iu.test(arg)) || /(?:^|[\\/])pnpm(?:\.cmd|\.exe)?$/iu.test(spawn.file)

/**
 * Normalize an install-trial log into review facts: plugin activity only, without DSH's own baseline (the first
 * start before installation) or its pnpm installation runs, with temporary and local paths replaced.
 * @param {object} raw - the JSON report of test/dsh-composition/install-trial.mjs.
 * @param {{ names: string[] }} options - the package names that were installed.
 * @returns {object} trial facts.
 */
export function summarizeTrial(raw, { names }) {
  const tidy = (text) => {
    let value = String(text)
    if (raw.root) value = value.replaceAll(raw.root, '<tmp>')
    return value.replace(/[A-Za-z]:\\[^\s"']*?[\\/]node(?:\.exe)?(?=\s|$)/gu, '<node>').replace(/[A-Za-z]:\\[^\s"']*?pnpm\.[cm]?js/gu, '<pnpm>')
  }
  const plugin = (items, keep = () => true) => items.filter(item => groupOf(item.phase) !== null && keep(item))
  const program = file => tidy(file).split(/[\\/]/u).pop()
  const processes = plugin(raw.spawns ?? [], spawn => !(groupOf(spawn.phase) === 'install' && isPackageManagerRun(spawn)))
  const connections = plugin(raw.connections ?? [])
  const installTraffic = connections.filter(item => groupOf(item.phase) === 'install' && item.allowed)
  const states = (boot) => names.flatMap(name => (raw.states?.[`${boot}:${name}`]?.rows ?? []).map(row => `${row.row}=${row.state}${row.error ? ` (${row.error})` : ''}`))
  const afterInstall = states('boot1')
  const afterRestart = states('boot2')
  const installs = (raw.installs ?? []).map(item => ({
    spec: item.spec, application: item.application, version: item.version ?? null,
    ...item.error ? { error: tidy(item.error) } : {}, ...item.kind ? { kind: item.kind } : {},
    ...item.pendingBuilds?.length ? { pendingBuilds: item.pendingBuilds } : {},
  }))
  const active = rows => rows.length > 0 && rows.every(row => row.includes('=ACTIVE'))
  return {
    dshVersion: raw.dshVersion ?? null,
    ok: raw.failure === undefined && installs.length > 0 && installs.every(item => item.application === 'applied') && active(afterInstall) && active(afterRestart),
    ...raw.failure === undefined ? {} : { failure: tidy(String(raw.failure).split('\n')[0]) },
    installs,
    entries: { afterInstall, afterRestart },
    registrations: {
      tools: unique((raw.tools ?? []).filter(item => groupOf(item.phase) === 'install').map(item => item.name)).sort(),
      skills: unique((raw.skills ?? []).filter(item => groupOf(item.phase) === 'install').map(item => `${item.name}${item.source ? ` (${item.source})` : ''}`)).sort(),
      webRoutes: unique((raw.webRoutes ?? []).filter(item => groupOf(item.phase) === 'install').map(item => item.path)).sort(),
      connectionRoutes: (raw.connectionRoutes ?? []).map(item => `${item.methods.join(',')} ${item.path}`).sort(),
    },
    processes: counted(processes.map(item => `${groupOf(item.phase)}: ${[program(item.file), ...item.args.map(tidy)].join(' ')}`)),
    programs: unique(processes.map(item => program(item.file).replace(/^<node>$|^node\.exe$/iu, 'node'))).sort(),
    installTraffic: counted(installTraffic.map(item => item.target)),
    connections: counted(connections.filter(item => !installTraffic.includes(item)).map(item => `${groupOf(item.phase)}: ${item.target}${item.allowed ? '' : ' (refused)'}`)),
    fetches: counted(plugin(raw.fetches ?? []).map(item => `${groupOf(item.phase)}: ${item.method ?? ''} ${tidy(item.url)}${item.authorization ? ' (Authorization)' : ''}`.replace(/: +/u, ': '))),
    credentialReads: counted(plugin(raw.credentials ?? []).map(item => `${groupOf(item.phase)}: ${item.name}`)),
    calls: (raw.calls ?? []).map(item => ({
      call: `${item.method} ${item.path}`, kind: item.kind, status: item.status ?? null, body: item.body === undefined ? null : tidy(item.body),
      ...item.error ? { error: tidy(item.error) } : {},
      credentialReads: item.credentialReads ?? [], fetches: (item.fetches ?? []).map(tidy), spawns: (item.spawns ?? []).map(tidy), connections: item.connections ?? [],
    })),
  }
}

/** Hosts the trial saw the plugin contact (in-process fetches and proxied connections outside the installation). */
export function trialHosts(trial) {
  if (!trial || trial.skipped) return []
  const hosts = []
  for (const line of [...trial.fetches, ...trial.connections]) {
    const match = /(?:https?:\/\/|: )([a-z0-9.-]+\.[a-z]{2,})(?::\d+)?/iu.exec(line)
    if (match) hosts.push(match[1].toLowerCase())
  }
  return unique(hosts).sort()
}

// ---- comparison --------------------------------------------------------------------------------------------------

/** Files added, removed, and changed between two package trees. */
export function diffFiles(before, after) {
  const map = files => new Map([...files.entries()])
  const a = map(before)
  const b = map(after)
  const added = [...b.keys()].filter(path => !a.has(path)).sort().map(path => ({ path, after: b.get(path).length }))
  const removed = [...a.keys()].filter(path => !b.has(path)).sort().map(path => ({ path, before: a.get(path).length }))
  const changed = [...b.keys()].filter(path => a.has(path) && !a.get(path).equals(b.get(path))).sort()
    .map(path => ({ path, before: a.get(path).length, after: b.get(path).length }))
  return { added, removed, changed, unchanged: [...b.keys()].filter(path => a.has(path) && a.get(path).equals(b.get(path))).length }
}

/** A bundler chunk name such as `client-BqmXJ0vt.js`, compared without its content hash. */
const CHUNK = /-([A-Za-z0-9_]{8})(?=\.[mc]?js$)/u
function stableName(path) {
  const match = CHUNK.exec(path)
  return match !== null && /[0-9A-Z]/u.test(match[1]) && /[a-z]/u.test(match[1]) ? path.replace(CHUNK, '-*') : path
}
const stable = paths => unique((paths ?? []).map(stableName)).sort()

const setDiff = (before = [], after = []) => ({ added: after.filter(item => !before.includes(item)), removed: before.filter(item => !after.includes(item)) })

function deltaText(before, after) {
  const { added, removed } = setDiff(before, after)
  if (added.length === 0 && removed.length === 0) return '无变化 · unchanged'
  return [...added.length ? [`+ ${list(added, 8)}`] : [], ...removed.length ? [`− ${list(removed, 8)}`] : []].join('；')
}

const dependencyList = report => Object.entries({ ...report.dependencies, ...report.optionalDependencies }).map(([name, range]) => `${name}@${range}`).sort()
const compatText = report => `engines.dsh ${report.enginesDsh ?? '—'}; peers ${Object.entries(report.dshPeers).map(([peer, range]) => `${peer.replace('@deepseek-ai/', '')} ${range}`).join(', ') || '—'}`
const provenanceText = report => (report.provenance ? `${report.provenance.repository?.replace('https://github.com/', '') ?? '?'} ${report.provenance.ref ?? ''} ${report.provenance.commit?.slice(0, 7) ?? ''}`.trim() : '—')

/**
 * Compare two versions' facts.
 * @returns {{ rows: { label: string, before: string, after: string, change: string, important: boolean }[],
 *   highlights: string[], files?: object, compareUrl?: string }} the comparison.
 */
export function compareFacts(previous, current, files) {
  const rows = []
  const add = (label, before, after, important, change) => {
    const changed = JSON.stringify(before) !== JSON.stringify(after)
    rows.push({
      label,
      before: Array.isArray(before) ? list(before, 8) : String(before ?? '—'),
      after: Array.isArray(after) ? list(after, 8) : String(after ?? '—'),
      change: change ?? (changed ? (Array.isArray(before) ? deltaText(before, after) : '有变化 · changed') : '无变化 · unchanged'),
      changed,
      important: important && changed,
    })
  }
  const p = previous.report
  const c = current.report
  add('许可证 · License', `${p.license} (${p.licenseFiles.join(', ') || 'no LICENSE file'})`, `${c.license} (${c.licenseFiles.join(', ') || 'no LICENSE file'})`, true)
  const sameSource = (p.provenance?.repository ?? null) === (c.provenance?.repository ?? null) && (p.provenance?.workflow ?? null) === (c.provenance?.workflow ?? null)
  add('构建来源 · Provenance', provenanceText(p), provenanceText(c), !sameSource,
    provenanceText(p) === provenanceText(c) ? '无变化 · unchanged' : sameSource ? '新 tag/commit，仓库与工作流相同 · new tag/commit, same repository and workflow' : '仓库或工作流变了 · repository or workflow changed')
  add('DSH 声明 · engines / peers', compatText(p), compatText(c), true)
  add(`兼容 ${c.target} · Compatible`, `发现 ${yes(p.compatibleInDiscover)} 安装 ${yes(p.compatibleAtInstall)}`, `发现 ${yes(c.compatibleInDiscover)} 安装 ${yes(c.compatibleAtInstall)}`, true)
  add('安装脚本 · Install scripts', p.installScripts, c.installScripts, true)
  add('直接依赖 · Dependencies', dependencyList(p), dependencyList(c), true)
  add('依赖树中有安装脚本的包 · Tree packages with install scripts', p.dependencyTree?.withInstallScripts ?? [], c.dependencyTree?.withInstallScripts ?? [], true)
  add('依赖树中非 OSI 许可 · Tree licenses outside the list', p.dependencyTree?.licensesOutsideList ?? [], c.dependencyTree?.licensesOutsideList ?? [], true)
  const growth = p.unpackedBytes === 0 ? 0 : (c.unpackedBytes - p.unpackedBytes) / p.unpackedBytes
  add('解包大小 · Unpacked size', `${kib(p.unpackedBytes)}, ${p.fileCount} files`, `${kib(c.unpackedBytes)}, ${c.fileCount} files`, Math.abs(growth) > 0.25,
    p.unpackedBytes === c.unpackedBytes && p.fileCount === c.fileCount ? '无变化 · unchanged' : `${growth >= 0 ? '+' : ''}${(growth * 100).toFixed(1)}%, ${c.fileCount - p.fileCount >= 0 ? '+' : ''}${c.fileCount - p.fileCount} files`)
  add('代码中的主机 · Hosts in code', Object.keys(p.hosts), Object.keys(c.hosts), true)
  for (const [key, label] of Object.entries(HINT_LABELS)) {
    add(`线索：${label}`, stable(p.hints[key]), stable(c.hints[key]), key !== 'environment' && key !== 'network' && key !== 'fileWrites')
  }
  add('环境变量名 · Environment variable names', Object.keys(p.envVars), Object.keys(c.envVars), true)
  const pt = previous.trial
  const ct = current.trial
  if (pt && !pt.skipped && ct && !ct.skipped) {
    const reg = trial => [...trial.registrations.tools.map(name => `tool ${name}`), ...trial.registrations.skills.map(name => `skill ${name}`),
      ...trial.registrations.webRoutes.map(path => `web ${path}`), ...trial.registrations.connectionRoutes.map(route => `route ${route}`)]
    add('试用：注册项 · Trial: registrations', reg(pt), reg(ct), true)
    add('试用：子进程 · Trial: child processes', pt.processes.map(stripCount), ct.processes.map(stripCount), true)
    add('试用：外连 · Trial: connections', pt.connections.map(stripCount), ct.connections.map(stripCount), true)
    add('试用：进程内 fetch · Trial: fetch', pt.fetches.map(stripCount), ct.fetches.map(stripCount), true)
    add('试用：凭据读取 · Trial: credential reads', pt.credentialReads.map(stripCount), ct.credentialReads.map(stripCount), true)
    add('试用：安装与运行 · Trial: install and run', pt.ok ? 'OK' : 'failed', ct.ok ? 'OK' : 'failed', true)
  }
  const compareUrl = p.provenance?.repository && p.provenance.repository === c.provenance?.repository && p.provenance.commit && c.provenance.commit
    ? `${c.provenance.repository}/compare/${p.provenance.commit.slice(0, 12)}...${c.provenance.commit.slice(0, 12)}`
    : undefined
  return { rows, highlights: rows.filter(row => row.important).map(row => row.label), ...files ? { files } : {}, ...compareUrl ? { compareUrl } : {} }
}

const stripCount = line => line.replace(/ ×\d+$/u, '')

// ---- draft plugins.yml entry -------------------------------------------------------------------------------------

const PLAIN = /^[A-Za-z0-9][A-Za-z0-9._/+=:@-]*$/u
/** A YAML scalar: plain when that is unambiguous, otherwise double-quoted. */
export function yamlScalar(value) {
  const text = String(value)
  if (PLAIN.test(text) && !text.endsWith(':') && !/^(?:true|false|null|yes|no|on|off|y|n)$/iu.test(text) && !/^[0-9_]+(?:\.[0-9_]*)?(?:e[+-]?[0-9]+)?$/iu.test(text)) return text
  return JSON.stringify(text)
}
const flow = items => `[${items.map(yamlScalar).join(', ')}]`

/** A folded block scalar (`>-`) wrapped at spaces; long runs without spaces stay on one line. */
function folded(text, indent, width = 118) {
  const words = String(text).replace(/\s+/gu, ' ').trim().split(' ')
  const lines = []
  let line = ''
  for (const word of words) {
    if (line !== '' && indent.length + line.length + 1 + word.length > width) {
      lines.push(line)
      line = word
    } else line = line === '' ? word : `${line} ${word}`
  }
  if (line !== '') lines.push(line)
  return `>-\n${lines.map(item => `${indent}${item}`).join('\n')}`
}

function text(value, indent) {
  const string = String(value)
  return string.length > 80 || /:\s|\s#|\n/u.test(string) ? folded(string, indent) : yamlScalar(string)
}

function localized(value, indent) {
  if (typeof value === 'string') return ` ${text(value, `${indent}  `)}`
  return `\n${Object.entries(value).map(([language, member]) => `${indent}${language}: ${text(member, `${indent}  `)}`).join('\n')}`
}

const CATEGORY_HINTS = [
  ['browser', /browser|chrom|playwright|puppeteer|web ?page|crawl/iu],
  ['memory', /memory|remember|recall|knowledge/iu],
  ['usage', /usage|cost|token|billing|balance|context window/iu],
  ['theme', /theme|skin|wallpaper|appearance/iu],
  ['media', /image|video|audio|media|music|voice/iu],
  ['docs', /\bdoc|office|pdf|word|excel|spreadsheet|markdown/iu],
  ['workflow', /workflow|team|multi-agent|orchestrat|automation|task board/iu],
  ['session', /session|archive|history|conversation/iu],
  ['dev', /\bgit\b|code review|lint|debug|developer|\bdev\b|terminal|ssh/iu],
  ['integration', /\bim\b|slack|wechat|feishu|lark|telegram|notify|mcp|integration/iu],
  ['ui', /\bui\b|sidebar|panel|layout|interface/iu],
]

/** A category for a new plugin from its keywords and description, among the declared ones; `tools` otherwise. */
export function guessCategory(report, categories) {
  const haystack = [report.name, report.description ?? '', ...report.keywords].join(' ')
  const hit = CATEGORY_HINTS.find(([id, pattern]) => Object.hasOwn(categories, id) && pattern.test(haystack))
  return hit?.[0] ?? (Object.hasOwn(categories, 'tools') ? 'tools' : Object.keys(categories)[0])
}

/** Where users report problems: the manifest `bugs`, else the GitHub repository's issues. */
export function maintainerOf(report) {
  if (typeof report.bugs === 'string' && (/^https:\/\//u.test(report.bugs) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(report.bugs))) return report.bugs
  if (typeof report.repository === 'string' && /^https:\/\/github\.com\/[^/]+\/[^/]+$/u.test(report.repository)) return `${report.repository}/issues`
  return 'TODO'
}

/** The capabilities a review records, inferred from the code hints and the trial. */
export function inferCapabilities(report, trial) {
  const network = unique([...Object.keys(report.hosts), ...trialHosts(trial)]).sort()
  return {
    network,
    files: report.hints.fileWrites.length > 0 ? 'write' : 'none',
    config: report.hints.configWrites.length > 0 ? 'write' : report.hints.configReads.length > 0 ? 'read' : 'none',
    childProcess: trial && !trial.skipped ? trial.programs : [],
  }
}

const LEVEL = { none: 0, read: 1, write: 2 }
/**
 * Capabilities for a new version of a listed plugin: the reviewed version's judgment, widened by what is new since the
 * version it was compared with (hosts that appear in code, programs the trial started, file or settings access hints).
 */
function carryOver(reviewed, inferred, report, previousReport, trial) {
  const newHosts = [...Object.keys(report.hosts).filter(host => !Object.hasOwn(previousReport.hosts, host)), ...trialHosts(trial).filter(host => !reviewed.network.includes(host))]
    .filter((host, position, all) => all.indexOf(host) === position && !reviewed.network.includes(host))
  const higher = (a, b) => (LEVEL[b] > LEVEL[a] ? b : a)
  return {
    newHosts,
    capabilities: {
      network: unique([...reviewed.network, ...newHosts]).sort(),
      files: report.hints.fileWrites.length > previousReport.hints.fileWrites.length ? higher(reviewed.files, inferred.files) : reviewed.files,
      config: higher(reviewed.config, report.hints.configWrites.length > previousReport.hints.configWrites.length ? inferred.config : 'none'),
      childProcess: unique([...reviewed.childProcess, ...inferred.childProcess]).sort(),
    },
  }
}

/** A factual summary for `review.notes`; the reviewer adds judgment. */
export function autoNotes({ report, trial, delta, previous }) {
  const parts = []
  parts.push(report.provenance
    ? `npm provenance: built from ${report.provenance.repository?.replace('https://', '')} ${report.provenance.ref?.replace('refs/tags/', 'tag ')} (commit ${report.provenance.commit?.slice(0, 7)}).`
    : 'No npm provenance.')
  const deps = dependencyList(report)
  const tree = report.dependencyTree
  parts.push(deps.length === 0 ? 'No dependencies.' : `Dependencies: ${deps.join(', ')} (resolved tree ${tree?.count ?? '?'} package(s)${tree?.withInstallScripts?.length ? `, install scripts in ${tree.withInstallScripts.join(', ')}` : ', none with install scripts'}).`)
  parts.push(report.installScripts.length === 0 ? 'No install scripts.' : `Install scripts: ${report.installScripts.join(', ')}.`)
  const hinted = Object.entries(report.hints).filter(([, paths]) => paths.length > 0).map(([key, paths]) => `${key} (${paths.slice(0, 3).join(', ')}${paths.length > 3 ? ', …' : ''})`)
  if (hinted.length > 0) parts.push(`Code hints (static scan): ${hinted.join('; ')}.`)
  if (Object.keys(report.hosts).length > 0) parts.push(`Hosts in code: ${Object.keys(report.hosts).join(', ')}.`)
  if (trial && !trial.skipped) {
    const r = trial.registrations
    const registered = [...r.tools.map(name => `tool ${name}`), ...r.skills.map(name => `skill ${name}`), ...r.webRoutes.map(path => `web route ${path}`), ...r.connectionRoutes.map(route => `route ${route}`)]
    parts.push(`Trial on DSH ${trial.dshVersion} (installBundle in a temporary profile): ${trial.ok ? 'installed and ACTIVE after hot install and after restart' : `did not pass (${trial.failure ?? trial.installs.map(item => item.application).join(', ')})`}; registered ${registered.join(', ') || 'nothing visible to the trial'}; child processes ${trial.programs.join(', ') || 'none'}; outbound connections outside installation ${trial.connections.length === 0 ? 'none' : trial.connections.join(', ')}; credential reads ${trial.credentialReads.length === 0 ? 'none' : trial.credentialReads.join(', ')}.`)
    for (const call of trial.calls) {
      parts.push(`Call ${call.call}: ${call.status ?? call.error ?? 'not found'}${call.credentialReads.length ? `, read ${call.credentialReads.join(', ')}` : ''}${call.fetches.length ? `, requested ${call.fetches.join(', ')}` : ''}.`)
    }
  } else parts.push(`No install trial (${trial?.skipped ?? 'not run'}).`)
  if (delta && previous) {
    const highlights = delta.highlights.map(label => label.split(' · ').pop())
    const files = delta.files === undefined ? '' : ` Package files since ${previous}: ${delta.files.added.length} added, ${delta.files.removed.length} removed, ${delta.files.changed.length} changed${delta.files.changed.length > 0 ? ` (${delta.files.changed.slice(0, 5).map(item => item.path).join(', ')}${delta.files.changed.length > 5 ? ', …' : ''})` : ''}.`
    parts.push(highlights.length === 0
      ? `Changes since ${previous}: none in license, provenance source, DSH compatibility, install scripts, dependencies, hosts in code, code hints, or trial behavior.${files}`
      : `Changes since ${previous} to review: ${highlights.join(', ')}.${files}`)
  }
  return parts.join(' ')
}

/** The YAML of one version record, at the indentation of a `versions:` item in plugins.yml. */
function versionYaml(version, indent) {
  const i = indent
  const r = version.review
  const capabilityComment = version.comments?.network ? ` # ${version.comments.network}` : ''
  const childComment = version.comments?.childProcess ? ` # ${version.comments.childProcess}` : ''
  const testedComment = version.comments?.testedOn ? ` # ${version.comments.testedOn}` : ''
  return [
    `${i}- version: ${yamlScalar(version.version)}`,
    `${i}  integrity: ${yamlScalar(version.integrity)}`,
    `${i}  review:`,
    `${i}    reviewer: ${yamlScalar(r.reviewer)}`,
    `${i}    date: ${yamlScalar(r.date)}`,
    `${i}    license: ${yamlScalar(r.license)}`,
    `${i}    testedOn: ${flow(r.testedOn)}${testedComment}`,
    `${i}    capabilities:`,
    `${i}      network: ${flow(r.capabilities.network)}${capabilityComment}`,
    `${i}      files: ${yamlScalar(r.capabilities.files)}`,
    `${i}      config: ${yamlScalar(r.capabilities.config)}`,
    `${i}      childProcess: ${flow(r.capabilities.childProcess)}${childComment}`,
    `${i}    installScripts: ${flow(r.installScripts)}`,
    ...r.sizeException === undefined ? [] : [`${i}    sizeException: ${text(r.sizeException, `${i}      `)}`],
    `${i}    notes: ${text(r.notes, `${i}      `)}`,
  ].join('\n')
}

/** The YAML of a plugin entry with the given version records, at the indentation of a `plugins:` item. */
function pluginYaml(plugin, versions, comments = {}) {
  const lines = [
    `  - name: ${yamlScalar(plugin.name)}`,
    `    category: ${yamlScalar(plugin.category)}${comments.category ? ` # ${comments.category}` : ''}`,
    `    tags: ${flow(plugin.tags ?? [])}`,
    `    maintainer: ${yamlScalar(plugin.maintainer)}${comments.maintainer ? ` # ${comments.maintainer}` : ''}`,
  ]
  if (plugin.display !== undefined) {
    lines.push('    display:')
    if (comments.display) lines.push(`      # ${comments.display}`)
    if (plugin.display.title !== undefined) lines.push(`      title:${localized(plugin.display.title, '        ')}`)
    if (plugin.display.description !== undefined) lines.push(`      description:${localized(plugin.display.description, '        ')}`)
  }
  lines.push('    versions:', ...versions.map(version => versionYaml(version, '      ')))
  return lines.join('\n')
}

/**
 * The draft for plugins.yml. A listed version reproduces its record; a new version of a listed plugin is one
 * `versions` item; a new plugin is a whole entry. Only the verdict, the risk notes, and display text stay TODO.
 * @returns {{ kind: 'listed' | 'update' | 'new', yaml: string }} the draft and where it goes.
 */
export function draftEntry({ report, trial, listing, categories, delta, previous, previousReport, today, reviewer = 'VibeDev' }) {
  if (listing.version !== undefined) {
    return { kind: 'listed', yaml: pluginYaml(listing.plugin, [listing.version]) }
  }
  const trialPassed = trial && !trial.skipped && trial.ok
  const inferred = inferCapabilities(report, trial)
  const base = listing.plugin?.versions?.find(item => item.version === previous)
  const carried = base !== undefined && previousReport !== undefined ? carryOver(base.review.capabilities, inferred, report, previousReport, trial) : undefined
  const capabilities = carried?.capabilities ?? inferred
  const version = {
    version: report.version,
    integrity: report.integrity,
    review: {
      reviewer, date: today, license: report.license ?? 'TODO', testedOn: trialPassed ? [report.target] : [],
      capabilities, installScripts: report.installScripts,
      ...report.unpackedBytes > 20 * 1024 * 1024 ? { sizeException: 'TODO: why this size is acceptable' } : {},
      notes: autoNotes({ report, trial, delta, previous }),
    },
    comments: {
      network: carried !== undefined
        ? `沿用 ${base.version} 的审核判断${carried.newHosts.length ? `，新增 ${carried.newHosts.join(', ')}（请确认）` : ''} · carried over from ${base.version}${carried.newHosts.length ? `; new: ${carried.newHosts.join(', ')} (confirm)` : ''}`
        : '代码中出现的主机和试用中连接过的主机；删去只是链接的 · hosts in code and seen in the trial; drop link-only hosts',
      ...report.hints.childProcess.length > 0 && capabilities.childProcess.length === 0
        ? { childProcess: `代码有子进程线索（${report.hints.childProcess.slice(0, 3).join(', ')}），请确认启动的程序 · child-process hints; name the programs` }
        : {},
      ...trialPassed ? {} : { testedOn: '试用未通过或未运行，需人工试用后填写 · trial did not pass or did not run' },
    },
  }
  if (listing.plugin !== undefined) {
    return { kind: 'update', yaml: [`      # 加在 plugins.yml 中 ${listing.plugin.name} 的 versions: 下 · add under versions: of ${listing.plugin.name}`, versionYaml(version, '      ')].join('\n') }
  }
  const plugin = {
    name: report.name,
    category: guessCategory(report, categories),
    tags: [],
    maintainer: maintainerOf(report),
    display: { description: { en: 'TODO', zh: 'TODO' } },
  }
  return {
    kind: 'new',
    yaml: pluginYaml(plugin, [version], {
      category: '按关键词推测，请确认 · guessed from keywords; confirm',
      ...plugin.maintainer === 'TODO' ? { maintainer: 'issue 地址或邮箱 · issue tracker URL or e-mail' } : {},
      display: '用户可见的说明与风险提示（TODO）；title 可省略，省略时用包自带的标题 · user-visible description and risk notes (TODO); omit title to use the package title',
    }),
  }
}

// ---- Markdown record ---------------------------------------------------------------------------------------------

function verdictSection(listing) {
  if (listing.version === undefined) {
    return [
      '- 结论 · Verdict：**TODO**（收 / 有条件 / 不收 · include / conditional / exclude）',
      '- 用户可见的风险提示 · User-visible risk notes：**TODO**（写进 display.description · goes into display.description）',
      `- 收录状态 · Listing：${listing.plugin === undefined ? '未收录的新插件 · new plugin, not listed' : `插件已收录，此版本未收录 · plugin listed, this version not listed`}`,
    ].join('\n')
  }
  const description = listing.plugin.display?.description
  const notes = typeof description === 'string' ? [description] : description === undefined ? [] : [description.zh, description.en].filter(Boolean)
  return [
    '- 结论 · Verdict：**收 · include**（已收录于 plugins.yml · listed in plugins.yml）',
    `- 审核 · Review：${listing.version.review.reviewer}，${listing.version.review.date}，testedOn ${listing.version.review.testedOn.join(', ')}`,
    '- 用户可见的风险提示 · User-visible risk notes（plugins.yml `display.description`）：',
    ...notes.map(note => `  > ${note.replace(/\s+/gu, ' ').trim()}`),
  ].join('\n')
}

function packageSection(report) {
  const tree = report.dependencyTree
  return table(['项目 · Item', '值 · Value'], [
    ['版本 · Version', `${report.version}（发布 · published ${report.published?.slice(0, 16).replace('T', ' ') ?? '?'} UTC；npm latest ${report.distTags.latest ?? '?'}；共 ${report.versionsPublished} 个版本，近 30 天 ${report.versionsLast30Days} 个 · versions, last 30 days）`],
    ['integrity', code(report.integrity)],
    ['弃用 · Deprecated', report.deprecated ?? '否 · no'],
    ['许可证 · License', `${report.license ?? '—'}（OSI ${yes(report.licenseAccepted)}；包内文件 · files: ${report.licenseFiles.join(', ') || '无 · none'}）`],
    ['构建来源 · Provenance', report.provenance ? `${report.provenance.repository} ${report.provenance.ref}，commit ${code(report.provenance.commit?.slice(0, 12) ?? '?')}（${report.provenance.workflow}）` : '无 · none'],
    ['DSH 声明 · DSH requirements', compatText(report)],
    [`兼容 ${report.target} · Compatible`, `发现页 · Discover ${yes(report.compatibleInDiscover)}；安装检查 · install check ${yes(report.compatibleAtInstall)}${Object.keys(report.unmet).length ? `（unmet ${JSON.stringify(report.unmet)}）` : ''}${report.declaresDsh ? '' : '；没有任何 DSH 声明 · no DSH declaration'}`],
    ['bundle', yes(report.bundle)],
    ['安装脚本 · Install scripts', `包 · package: ${report.installScripts.join(', ') || '无 · none'}；依赖树 · tree: ${tree ? (tree.withInstallScripts.join(', ') || '无 · none') : '未检查 · not checked'}`],
    ['体量 · Size', `解包 · unpacked ${kib(report.unpackedBytes)}，${report.fileCount} 个文件 · files；tarball ${kib(report.tarballBytes)}`],
    ['依赖 · Dependencies', `${dependencyList(report).join(', ') || '无 · none'}${tree ? `（解析后共 ${tree.count} 个包 · resolved packages${tree.truncated ? '，已截断 · truncated' : ''}；非 OSI 许可 · licenses outside the list: ${tree.licensesOutsideList.join(', ') || '无 · none'}）` : ''}`],
    ['其他 peer · Other peers', Object.entries(report.otherPeers).map(([peer, range]) => `${peer} ${range}`).join(', ') || '—'],
    ['仓库 · Repository', report.repository ?? '—'],
    ['问题反馈 · Issues', report.bugs ?? '—'],
    ['npm 维护者 · Maintainers', report.maintainers.join(', ') || '—'],
  ])
}

function hintsSection(report) {
  const rows = Object.entries(HINT_LABELS).map(([key, label]) => [label, list(report.hints[key] ?? [], 6)])
  const hosts = Object.entries(report.hosts).map(([host, paths]) => [code(host), list(paths, 3)])
  const env = Object.keys(report.envVars)
  return [
    table(['类别 · Category', '匹配的文件 · Files'], rows),
    '',
    '代码中出现的主机（链接也算，需判断是否真的会连接）· Hosts mentioned in code (links included; judge which are contacted):',
    '',
    hosts.length === 0 ? '—' : table(['主机 · Host', '出现位置 · Where'], hosts),
    '',
    `环境变量名 · Environment variable names：${list(env, 12)}`,
    '',
    `查看某条线索的原文 · Read a hint in context：${code(`npm run inspect -- ${report.name}@${report.version} --grep "<pattern>"`)}`,
  ].join('\n')
}

function trialSection(trial, report) {
  if (!trial || trial.skipped) return `未运行 · Not run：${trial?.skipped ?? '—'}。需要人工安装试用后再填写 testedOn · Run a hands-on trial before filling in testedOn.`
  const r = trial.registrations
  const rows = [
    ['DSH', `${trial.dshVersion}（web profile；临时 DSH_HOME、用户目录与 pnpm 仓库 · temporary DSH_HOME, user directory, and pnpm store；代理只放行 npm registry · proxy admits only the npm registry）`],
    ['安装 · Install', trial.installs.map(item => `${item.spec} → ${item.application}${item.version ? ` (${item.version})` : ''}${item.error ? `：${item.error}` : ''}${item.pendingBuilds ? `；待批准脚本 · pending builds ${item.pendingBuilds.join(', ')}` : ''}`).join('；')],
    ['条目 · Entries', `安装后 · after install：${list(trial.entries.afterInstall, 8, String)}；重启后 · after restart：${list(trial.entries.afterRestart, 8, String)}`],
    ['结果 · Result', trial.ok ? '✅ 安装成功，安装后和重启后都是 ACTIVE · installed, ACTIVE after install and after restart' : `❌ ${trial.failure ?? '见上 · see above'}`],
    ['工具 · Tools', list(r.tools, 10)],
    ['技能 · Skills', list(r.skills, 10)],
    ['Web 路由 · Web routes', list(r.webRoutes, 10)],
    ['连接路由 · Connection routes', list(r.connectionRoutes, 10)],
    ['子进程 · Child processes', list(trial.processes, 10)],
    ['安装流量 · Installation traffic', `${list(trial.installTraffic, 4, String)}（DSH 用 pnpm 安装本身 · DSH's own pnpm install）`],
    ['其他外连 · Other connections', list(trial.connections, 10)],
    ['进程内 fetch · In-process fetch', list(trial.fetches, 10)],
    ['凭据读取 · Credential reads', list(trial.credentialReads, 10)],
  ]
  const calls = trial.calls.map(call => `- ${code(call.call)}（${call.kind}）→ ${call.status ?? call.error ?? '—'}；凭据 · credentials: ${list(call.credentialReads, 5)}；fetch: ${list(call.fetches, 5)}；外连 · connections: ${list(call.connections, 5)}；子进程 · processes: ${list(call.spawns, 5)}`)
  return [
    table(['项目 · Item', '结果 · Result'], rows),
    ...calls.length ? ['', '调用 · Calls（`--call`）：', '', ...calls] : [],
    '',
    `说明 · Notes：分组 install = 热安装及首次启用，restart = 重启后，其他为 --call；不含安装前 DSH 自身的活动。浏览器端代码（${report.name} 的 client 包）没有在试用中运行，见第二节。 · Group install = hot install and first activation, restart = after a restart, others are --call; DSH's own activity before the install is excluded. Browser-side code did not run in the trial; see section 2.`,
  ].join('\n')
}

function changesSection(delta, previous) {
  const lines = [
    delta.highlights.length === 0
      ? '需要重点看的变化 · Changes to look at：无 · none'
      : `需要重点看的变化 · Changes to look at：${delta.highlights.map(label => `**${label}**`).join('，')}`,
    '',
    table(['项目 · Item', previous, '本版本 · this version', '变化 · Change'], delta.rows.map(row => [row.label, row.before, row.after, row.change])),
  ]
  if (delta.compareUrl) lines.push('', `源码对比 · Source diff：${delta.compareUrl}`)
  if (delta.files) {
    const { added, removed, changed, unchanged } = delta.files
    const rows = [
      ...added.map(item => ['+', code(item.path), '—', kib(item.after)]),
      ...removed.map(item => ['−', code(item.path), kib(item.before), '—']),
      ...changed.map(item => ['~', code(item.path), kib(item.before), kib(item.after)]),
    ]
    lines.push('', `包内文件 · Package files：新增 ${added.length}、删除 ${removed.length}、修改 ${changed.length}、未变 ${unchanged} · added, removed, changed, unchanged`)
    if (rows.length > 0) lines.push('', table(['', '文件 · File', previous, '本版本 · this version'], rows.slice(0, 40)), ...rows.length > 40 ? [`… +${rows.length - 40}`] : [])
  }
  return lines.join('\n')
}

/**
 * The review record.
 * @returns {string} Markdown.
 */
export function renderRecord({ report, trial, listing, draft, delta, previous, command, steps, tool, today }) {
  const where = {
    listed: '已收录；下面是 plugins.yml 中的记录 · Listed; this is the record in plugins.yml.',
    update: `插件已收录：把这条版本记录加到 plugins.yml 中该插件的 \`versions:\` 下；如果行为有变化，同时更新该插件的 display 文字。 · The plugin is listed: add this version record under its \`versions:\` in plugins.yml, and update the plugin's display text if its behavior changed.`,
    new: '新插件：把整段加到 plugins.yml 的 `plugins:` 下，并填写 TODO。 · New plugin: add the whole entry under `plugins:` and fill in the TODOs.',
  }[draft.kind]
  return `${[
    `# 审核记录 · Review record：${code(`${report.name}@${report.version}`)}`,
    '',
    `> 由 ${code(command)} 生成 · Generated by the command on ${today}；目标 DSH · target DSH ${report.target}；工具 · tools: vibedev-plugin-index ${tool.index}${tool.dsh ? `, DSH checkout ${tool.dsh}` : ''}。`,
    '> 带 **TODO** 的项由审核人判断填写，其余来自 npm、tarball 和安装试用。 · Items marked **TODO** need the reviewer\'s judgment; everything else comes from npm, the tarball, and the install trial.',
    '',
    '## 结论 · Verdict',
    '',
    verdictSection(listing),
    '',
    '## 一、包信息 · Package facts',
    '',
    packageSection(report),
    '',
    '## 二、代码线索（静态扫描，需读代码确认）· Code hints (static scan; confirm by reading the code)',
    '',
    hintsSection(report),
    '',
    '## 三、安装试用 · Install trial',
    '',
    trialSection(trial, report),
    '',
    ...previous === undefined ? [] : [`## 四、与 ${previous} 相比 · Changes since ${previous}`, '', changesSection(delta, previous), ''],
    `## ${previous === undefined ? '四' : '五'}、plugins.yml 草稿 · Draft entry`,
    '',
    where,
    '',
    '```yaml',
    draft.yaml,
    '```',
    '',
    `## ${previous === undefined ? '五' : '六'}、生成命令 · Commands`,
    '',
    '```sh',
    command,
    '# 分步等价命令 · equivalent steps',
    ...steps,
    '```',
  ].join('\n')}\n`
}
