#!/usr/bin/env node
/**
 * Reviewer helper: print the facts a review needs for one npm version, without installing or running it, and a
 * plugins.yml snippet with its integrity. The code scan only finds hints; the reviewer confirms each capability.
 *
 * Usage: node scripts/inspect.mjs <name>[@version] [--target 0.2.1-rc.2] [--deps] [--json]
 *   --deps  resolve the production dependency tree from the registry as an install would today, and report
 *           packages with install scripts and licenses outside the accepted list.
 */
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import semver from 'semver'
import { parse as parseYaml } from 'yaml'
import {
  declaresDsh, dshRange, dshSatisfies, installScripts, isBundle, isOsiLicense, unmetDshRequirements,
} from './lib/manifest.mjs'
import { fetchPackument, fetchTarball, PUBLIC_REGISTRY } from './lib/npm.mjs'
import { READ_LIMITS } from './lib/pipeline.mjs'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    target: { type: 'string' }, deps: { type: 'boolean', default: false }, json: { type: 'boolean', default: false },
    grep: { type: 'string' },
  },
})
if (positionals.length !== 1) {
  console.error('usage: node scripts/inspect.mjs <name>[@version] [--target <dsh version>] [--deps] [--json]')
  process.exit(2)
}
const spec = positionals[0]
const at = spec.lastIndexOf('@')
const name = at > 0 ? spec.slice(0, at) : spec
const target = values.target ?? parseYaml(readFileSync(new URL('../plugins.yml', import.meta.url), 'utf8')).target.dsh

const packument = await fetchPackument(name, { timeoutMs: READ_LIMITS.timeoutMs })
if (packument === undefined) {
  console.error(`${name} is not published on npm`)
  process.exit(1)
}
const version = at > 0 ? spec.slice(at + 1) : packument['dist-tags']?.latest
const published = packument.versions?.[version]
if (published === undefined) {
  console.error(`${name}@${version} is not published on npm`)
  process.exit(1)
}
const { files, manifest, tarballBytes } = await fetchTarball(name, version, published.dist, published.dist.integrity, READ_LIMITS)

if (values.grep !== undefined) {
  // `--grep <regex>`: show where the package's text files mention something, to confirm a capability by reading it.
  const pattern = new RegExp(values.grep, 'u')
  let shown = 0
  for (const [path, bytes] of files.entries()) {
    if (/\.(?:png|jpe?g|webp|gif|ico|woff2?|ttf|wasm|node|map)$/iu.test(path)) continue
    const lines = bytes.toString('utf8').split(/\r?\n/u)
    for (const [number, line] of lines.entries()) {
      const match = pattern.exec(line)
      if (match === null) continue
      const start = Math.max(0, match.index - 70)
      console.log(`${path}:${number + 1}: ${line.slice(start, start + 180).trim()}`)
      if (++shown >= 25) process.exit(0)
    }
  }
  process.exit(0)
}

const HINTS = {
  childProcess: /\b(?:node:)?child_process\b|\bexeca\b|\bcross-spawn\b/u,
  network: /\bfetch\(|\bhttps?\.(?:request|get)\(|\bnew WebSocket\(|\bXMLHttpRequest\b|\bnet\.connect\(|\bundici\b|\baxios\b/u,
  fileWrites: /\b(?:writeFile|appendFile|mkdir|rm|rmdir|unlink|rename|copyFile|cp)(?:Sync)?\(|\bcreateWriteStream\(/u,
  configWrites: /cordis\.patch\.yml|settings\.update\(|installBundle\(|removeBundle\(/u,
  environment: /process\.env\b/u,
  dynamicCode: /\beval\(|\bnew Function\(/u,
}
const IGNORED_HOSTS = /(?:^|\.)(?:w3\.org|schema\.org|reactjs\.org|react\.dev|mozilla\.org|example\.(?:com|org)|json-schema\.org|localhost|npmjs\.com|nodejs\.org|github\.com|githubusercontent\.com|opensource\.org|apache\.org|spdx\.org|tc39\.es|whatwg\.org|ietf\.org)$/u
const hints = Object.fromEntries(Object.keys(HINTS).map(key => [key, []]))
const hosts = new Map()
for (const [path, bytes] of files.entries()) {
  if (!/\.(?:m?js|cjs|jsx|ts|tsx|mts|cts|json|html)$/u.test(path) || /\.d\.[mc]?ts$|\.map$/u.test(path) || bytes.length > 8 * 1024 * 1024) continue
  const code = bytes.toString('utf8')
  // Hints come from code only; JSON files (package.json names its own cordis.patch.yml) are scanned for hosts alone.
  if (!path.endsWith('.json')) for (const [key, pattern] of Object.entries(HINTS)) if (pattern.test(code)) hints[key].push(path)
  for (const match of code.matchAll(/\b(?:https?|wss?):\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/giu)) {
    const host = match[1].toLowerCase()
    if (!IGNORED_HOSTS.test(host) && path !== 'package.json') hosts.set(host, (hosts.get(host) ?? 0) + 1)
  }
}

const range = dshRange(manifest)
const unmet = unmetDshRequirements(manifest, target)
const scripts = installScripts(manifest, files)
const report = {
  package: `${name}@${version}`,
  published: packument.time?.[version],
  distTags: packument['dist-tags'],
  versionsPublished: Object.keys(packument.versions ?? {}).length,
  deprecated: published.deprecated ?? null,
  integrity: published.dist.integrity,
  license: manifest.license ?? null,
  licenseAccepted: isOsiLicense(manifest.license),
  licenseFile: files.fileNames('').filter(file => /^(?:licen[cs]e|copying)/iu.test(file)),
  bundle: isBundle(manifest),
  enginesDsh: manifest.engines?.dsh ?? null,
  dshPeers: Object.fromEntries(Object.entries(manifest.peerDependencies ?? {}).filter(([peer]) => /^@deepseek-ai\/dsh(?:-|$)/u.test(peer))),
  indexEnginesDsh: range instanceof Error ? `invalid: ${range.message}` : range ?? '(any DSH version)',
  declaresDsh: declaresDsh(manifest),
  target,
  compatibleInDiscover: !(range instanceof Error) && (range === undefined || dshSatisfies(target, range)),
  compatibleAtInstall: Object.keys(unmet).length === 0,
  unmet,
  installScripts: scripts,
  npmHasInstallScript: published.hasInstallScript === true,
  unpackedBytes: files.bytes,
  fileCount: files.count,
  tarballBytes,
  dependencies: manifest.dependencies ?? {},
  optionalDependencies: manifest.optionalDependencies ?? {},
  repository: manifest.repository ?? null,
  homepage: manifest.homepage ?? null,
  maintainers: (packument.maintainers ?? []).map(person => person.name),
  hints: Object.fromEntries(Object.entries(hints).map(([key, paths]) => [key, paths.length === 0 ? [] : [...paths.slice(0, 5), ...paths.length > 5 ? [`… ${paths.length - 5} more`] : []]])),
  hosts: [...hosts].sort((left, right) => right[1] - left[1]).slice(0, 20).map(([host]) => host),
}

if (values.deps) report.dependencyTree = await dependencyTree({ ...manifest.dependencies, ...manifest.optionalDependencies })

if (values.json) {
  console.log(JSON.stringify(report, null, 2))
} else {
  for (const [key, value] of Object.entries(report)) console.log(`${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
  console.log(`\n# plugins.yml snippet (fill in the review from your own checks):
- name: ${JSON.stringify(name)}
  category: TODO
  tags: []
  maintainer: TODO-issue-tracker-url
  versions:
    - version: ${JSON.stringify(version)}
      integrity: ${published.dist.integrity}
      review:
        reviewer: TODO
        date: ${new Date().toISOString().slice(0, 10)}
        license: ${JSON.stringify(manifest.license ?? 'TODO')}
        testedOn: [${target}]
        capabilities:
          network: ${JSON.stringify(report.hosts.slice(0, 5))}
          files: ${hints.fileWrites.length > 0 ? 'write' : 'none'}
          config: ${hints.configWrites.length > 0 ? 'write' : 'none'}
          childProcess: ${hints.childProcess.length > 0 ? '[TODO]' : '[]'}
        installScripts: ${JSON.stringify(scripts)}
        notes: TODO`)
}

/** Resolve production dependencies breadth-first, picking the highest non-deprecated version each range admits. */
async function dependencyTree(roots) {
  const seen = new Map()
  const queue = Object.entries(roots ?? {})
  const flagged = []
  while (queue.length > 0 && seen.size < 300) {
    const batch = queue.splice(0, 8)
    await Promise.all(batch.map(async ([dependency, wanted]) => {
      if (typeof wanted !== 'string' || /^(?:file|link|git|https?):|\//u.test(wanted)) {
        flagged.push(`${dependency}@${wanted}: not a registry range`)
        return
      }
      const document = await fetchPackument(dependency, { registry: PUBLIC_REGISTRY, timeoutMs: READ_LIMITS.timeoutMs }).catch(error => error)
      if (document === undefined || document instanceof Error) {
        flagged.push(`${dependency}@${wanted}: registry read failed`)
        return
      }
      const tagged = document['dist-tags']?.[wanted]
      const candidates = Object.keys(document.versions ?? {}).filter(candidate => !document.versions[candidate].deprecated)
      const chosen = tagged ?? semver.maxSatisfying(candidates, wanted) ?? semver.maxSatisfying(Object.keys(document.versions ?? {}), wanted)
      if (chosen === null || chosen === undefined) {
        flagged.push(`${dependency}@${wanted}: no matching version`)
        return
      }
      const key = `${dependency}@${chosen}`
      if (seen.has(key)) return
      const meta = document.versions[chosen]
      seen.set(key, { license: meta.license ?? null, installScript: meta.hasInstallScript === true || ['preinstall', 'install', 'postinstall'].some(script => meta.scripts?.[script] !== undefined) })
      for (const entry of Object.entries({ ...meta.dependencies, ...meta.optionalDependencies })) queue.push(entry)
    }))
  }
  const packages = [...seen]
  return {
    packages: packages.length,
    truncated: queue.length > 0,
    withInstallScripts: packages.filter(([, info]) => info.installScript).map(([key]) => key),
    licensesOutsideList: packages.filter(([, info]) => !isOsiLicense(info.license)).map(([key, info]) => `${key} (${JSON.stringify(info.license)})`),
    unresolved: flagged,
  }
}
