/**
 * Static inspection of one npm version for a review: registry facts, the verified tarball, DSH compatibility, install
 * scripts, size, npm provenance, the production dependency tree, and code hints. Nothing is installed or run; the
 * hints only say where to read, and the reviewer confirms each capability.
 */
import semver from 'semver'
import {
  declaresDsh, dshRange, dshSatisfies, installScripts, isBundle, isOsiLicense, unmetDshRequirements,
} from './manifest.mjs'
import { repositoryUrl } from './display.mjs'
import { fetchPackument, fetchTarball, PUBLIC_REGISTRY } from './npm.mjs'
import { READ_LIMITS } from './pipeline.mjs'

/** Code patterns a reviewer must confirm by reading; each category lists the files that match. */
export const HINTS = {
  childProcess: /\b(?:node:)?child_process\b|\bexeca\b|\bcross-spawn\b|\.runPlugin\(/u,
  network: /\bfetch\(|\bhttps?\.(?:request|get)\(|\bnew WebSocket\(|\bnew EventSource\(|\bXMLHttpRequest\b|\bnet\.connect\(|\bundici\b|\baxios\b/u,
  // Calls, and named imports that minified code renames (`mkdir as s`).
  fileWrites: /\b(?:writeFile|appendFile|mkdir|rm|rmdir|unlink|rename|copyFile|cp|symlink|link)(?:Sync)?\(|\b(?:writeFile|appendFile|mkdir|rmdir|unlink|rename|copyFile|symlink|link)(?:Sync)?\s+as\s+[\w$]|\bcreateWriteStream\b/u,
  configWrites: /cordis\.patch\.yml|settings\.update\(|\.installBundle\(|\.removeBundle\(|pnpm-workspace\.yaml|\.setIndexes\(/u,
  configReads: /settings\.describe\(|\.get\(\s*["'`]settings["'`]\s*\)|\bconfigEditor\b/u,
  credentials: /\.get\(\s*["'`]credentials["'`]\s*\)|\bcredentials\.resolve\(|\bapiKey\b|\bBearer\s|_TOKEN\b|\.npmrc\b|\bkeytar\b/u,
  environment: /process\.env\b/u,
  dynamicCode: /\beval\(|\bnew Function\(|\bimport\(\s*[^'"`\s)]/u,
  selfUpdate: /\/latest\b|dist-tags|minimumReleaseAge|\bnpm\s+(?:i|install)\s|["'`]add["'`]\s*,\s*["'`]--|plugin\s+add\b/u,
  telemetry: /\btelemetry\b|\banalytics\b|\bheartbeat\b|\bposthog\b|\bsentry\b|\bmixpanel\b|\bumami\b|\bplausible\b|\bgtag\(|google-analytics/iu,
}

/** Chinese and English labels of the hint categories, in display order. */
export const HINT_LABELS = {
  childProcess: '子进程 · Child processes',
  network: '网络调用 · Network calls',
  fileWrites: '写文件 · File writes',
  configWrites: '修改 DSH 配置或安装 · DSH config writes / installs',
  configReads: '读取 DSH 设置 · Settings reads',
  credentials: '凭据与密钥 · Credentials and keys',
  environment: '环境变量 · Environment variables',
  dynamicCode: '动态代码 · Dynamic code',
  selfUpdate: '自我更新线索 · Self-update hints',
  telemetry: '遥测线索 · Telemetry hints',
}

/** Documentation and specification hosts that appear in code as links, never as services a plugin contacts. */
const DOC_HOST_SUFFIX = /(?:^|\.)(?:w3\.org|schema\.org|reactjs\.org|react\.dev|mozilla\.org|example\.(?:com|org|net)|json-schema\.org|npmjs\.com|nodejs\.org|opensource\.org|apache\.org|spdx\.org|tc39\.es|whatwg\.org|ietf\.org|wikipedia\.org|unicode\.org|ecma-international\.org)$/u
const DOC_HOSTS = new Set(['github.com', 'www.github.com'])
const CODE_FILE = /\.(?:m?js|cjs|jsx|ts|tsx|mts|cts|html?)$/u
const SKIPPED_FILE = /\.d\.[mc]?ts$|\.map$/u

/** Remove block comments and whole-line `//` comments, so license banners and doc links do not count as hosts. */
function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//gu, ' ').replace(/^\s*\/\/.*$/gmu, '')
}

/** The hint categories, hosts, and environment variable names of a package's code files. */
export function scanCode(files) {
  const hints = Object.fromEntries(Object.keys(HINTS).map(key => [key, []]))
  const hosts = new Map()
  const envVars = new Map()
  const add = (map, key, path) => { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(path) }
  for (const [path, bytes] of files.entries()) {
    if (path === 'package.json' || SKIPPED_FILE.test(path) || bytes.length > 8 * 1024 * 1024) continue
    const isCode = CODE_FILE.test(path)
    if (!isCode && !path.endsWith('.json')) continue
    const text = bytes.toString('utf8')
    const code = isCode ? stripComments(text) : text
    if (isCode) {
      for (const [key, pattern] of Object.entries(HINTS)) if (pattern.test(code)) hints[key].push(path)
      for (const match of code.matchAll(/process\.env(?:\.([A-Z_][A-Z0-9_]*)|\[\s*["'`]([A-Z_][A-Z0-9_]*)["'`]\s*\])/gu)) add(envVars, match[1] ?? match[2], path)
    }
    for (const match of code.matchAll(/\b(?:https?|wss?):\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/giu)) {
      const host = match[1].toLowerCase()
      if (!DOC_HOSTS.has(host) && !DOC_HOST_SUFFIX.test(host)) add(hosts, host, path)
    }
  }
  const sorted = map => Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b)).map(([key, paths]) => [key, [...paths].sort()]))
  return { hints: Object.fromEntries(Object.entries(hints).map(([key, paths]) => [key, paths.sort()])), hosts: sorted(hosts), envVars: sorted(envVars) }
}

/**
 * The npm provenance statement of a version: the repository, ref, workflow, and commit it was built from.
 * @returns {Promise<{ repository: string, ref: string, workflow: string, commit?: string } | null>} null without one.
 */
export async function fetchProvenance(name, version) {
  try {
    const response = await fetch(`${PUBLIC_REGISTRY}-/npm/v1/attestations/${name.replace('/', '%2f')}@${version}`, { signal: AbortSignal.timeout(READ_LIMITS.timeoutMs) })
    if (!response.ok) return null
    const { attestations = [] } = await response.json()
    const slsa = attestations.find(item => String(item.predicateType).includes('slsa.dev/provenance'))
    if (slsa === undefined) return null
    const statement = JSON.parse(Buffer.from(slsa.bundle.dsseEnvelope.payload, 'base64').toString('utf8'))
    const workflow = statement.predicate?.buildDefinition?.externalParameters?.workflow ?? {}
    const commit = statement.predicate?.buildDefinition?.resolvedDependencies?.[0]?.digest?.gitCommit
    return { repository: workflow.repository ?? null, ref: workflow.ref ?? null, workflow: workflow.path ?? null, ...commit === undefined ? {} : { commit } }
  } catch {
    // An unreadable statement counts as none; the review shows "no provenance".
    return null
  }
}

/** Resolve production dependencies breadth-first, picking the highest non-deprecated version each range admits. */
export async function dependencyTree(roots) {
  const seen = new Map()
  const queue = Object.entries(roots ?? {})
  const unresolved = []
  while (queue.length > 0 && seen.size < 300) {
    const batch = queue.splice(0, 8)
    await Promise.all(batch.map(async ([dependency, wanted]) => {
      if (typeof wanted !== 'string' || /^(?:file|link|git|https?):|\//u.test(wanted)) {
        unresolved.push(`${dependency}@${wanted}: not a registry range`)
        return
      }
      const document = await fetchPackument(dependency, { registry: PUBLIC_REGISTRY, timeoutMs: READ_LIMITS.timeoutMs }).catch(error => error)
      if (document === undefined || document instanceof Error) {
        unresolved.push(`${dependency}@${wanted}: registry read failed`)
        return
      }
      const tagged = document['dist-tags']?.[wanted]
      const candidates = Object.keys(document.versions ?? {}).filter(candidate => !document.versions[candidate].deprecated)
      const chosen = tagged ?? semver.maxSatisfying(candidates, wanted) ?? semver.maxSatisfying(Object.keys(document.versions ?? {}), wanted)
      if (chosen === null || chosen === undefined) {
        unresolved.push(`${dependency}@${wanted}: no matching version`)
        return
      }
      const key = `${dependency}@${chosen}`
      if (seen.has(key)) return
      const meta = document.versions[chosen]
      seen.set(key, {
        name: dependency, version: chosen, license: typeof meta.license === 'string' ? meta.license : null,
        installScript: meta.hasInstallScript === true || ['preinstall', 'install', 'postinstall'].some(script => meta.scripts?.[script] !== undefined),
      })
      for (const entry of Object.entries({ ...meta.dependencies, ...meta.optionalDependencies })) queue.push(entry)
    }))
  }
  const packages = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || semver.compare(a.version, b.version))
  return {
    count: packages.length,
    truncated: queue.length > 0,
    packages,
    withInstallScripts: packages.filter(item => item.installScript).map(item => `${item.name}@${item.version}`),
    licensesOutsideList: packages.filter(item => !isOsiLicense(item.license)).map(item => `${item.name}@${item.version} (${JSON.stringify(item.license)})`),
    unresolved,
  }
}

/** The repository's web page from a manifest `repository` field, or null. */
function repositoryPage(value) {
  const declared = typeof value === 'string' ? value : typeof value?.url === 'string' ? value.url : undefined
  return declared === undefined ? null : repositoryUrl(declared) ?? null
}

/**
 * Inspect one version.
 * @param {string} name - package name.
 * @param {string | undefined} version - exact version; undefined selects npm's `latest`.
 * @param {{ target: string, deps?: boolean }} options - the DSH version to check against, and whether to resolve the
 *   dependency tree.
 * @returns {Promise<{ report: object, files: import('./package-files.mjs').PackageFiles }>} the facts and the files.
 * @throws {Error} when the package or version is not on npm or the tarball fails verification.
 */
export async function inspectVersion(name, version, { target, deps = true }) {
  const packument = await fetchPackument(name, { timeoutMs: READ_LIMITS.timeoutMs })
  if (packument === undefined) throw new Error(`${name} is not published on npm`)
  const exact = version ?? packument['dist-tags']?.latest
  const published = packument.versions?.[exact]
  if (published === undefined) throw new Error(`${name}@${exact} is not published on npm`)
  const [{ files, manifest, tarballBytes }, provenance] = await Promise.all([
    fetchTarball(name, exact, published.dist, published.dist.integrity, READ_LIMITS),
    fetchProvenance(name, exact),
  ])
  const range = dshRange(manifest)
  const unmet = unmetDshRequirements(manifest, target)
  const peers = Object.entries(manifest.peerDependencies ?? {})
  const now = Date.now()
  const times = Object.entries(packument.time ?? {}).filter(([key]) => key !== 'created' && key !== 'modified')
  const report = {
    name,
    version: exact,
    published: packument.time?.[exact] ?? null,
    distTags: packument['dist-tags'] ?? {},
    versionsPublished: Object.keys(packument.versions ?? {}).length,
    versionsLast30Days: times.filter(([, time]) => now - Date.parse(time) < 30 * 86_400_000).length,
    deprecated: typeof published.deprecated === 'string' && published.deprecated !== '' ? published.deprecated : null,
    integrity: published.dist.integrity,
    license: manifest.license ?? null,
    licenseAccepted: isOsiLicense(manifest.license),
    licenseFiles: files.fileNames('').filter(file => /^(?:licen[cs]e|copying)/iu.test(file)),
    provenance,
    bundle: isBundle(manifest),
    enginesDsh: typeof manifest.engines?.dsh === 'string' ? manifest.engines.dsh : null,
    dshPeers: Object.fromEntries(peers.filter(([peer]) => /^@deepseek-ai\/dsh(?:-|$)/u.test(peer))),
    otherPeers: Object.fromEntries(peers.filter(([peer]) => !/^@deepseek-ai\/(?:dsh(?:-|$)|cordis$|schemastery$)/u.test(peer))),
    indexEnginesDsh: range instanceof Error ? `invalid: ${range.message}` : range ?? null,
    declaresDsh: declaresDsh(manifest),
    target,
    compatibleInDiscover: !(range instanceof Error) && (range === undefined || dshSatisfies(target, range)),
    compatibleAtInstall: Object.keys(unmet).length === 0,
    unmet,
    installScripts: installScripts(manifest, files),
    npmHasInstallScript: published.hasInstallScript === true,
    unpackedBytes: files.bytes,
    fileCount: files.count,
    tarballBytes,
    dependencies: manifest.dependencies ?? {},
    optionalDependencies: manifest.optionalDependencies ?? {},
    description: typeof manifest.description === 'string' ? manifest.description : null,
    keywords: Array.isArray(manifest.keywords) ? manifest.keywords.filter(keyword => typeof keyword === 'string') : [],
    repository: repositoryPage(manifest.repository),
    homepage: typeof manifest.homepage === 'string' ? manifest.homepage : null,
    bugs: typeof manifest.bugs === 'string' ? manifest.bugs : manifest.bugs?.url ?? manifest.bugs?.email ?? null,
    maintainers: (packument.maintainers ?? []).map(person => person.name),
    ...scanCode(files),
  }
  if (deps) report.dependencyTree = await dependencyTree({ ...manifest.dependencies, ...manifest.optionalDependencies })
  return { report, files }
}
