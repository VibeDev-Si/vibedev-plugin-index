/**
 * Package manifest rules: bundle declaration, the `engines.dsh` range an index lists, DSH's install-time
 * compatibility check, install scripts, and licenses.
 * `isBundle` and `dshRange` are adapted from DeepSeek Harness apps/plugin-market-generator/src/packages.ts, and
 * `unmetDshRequirements` from packages/boot/app-boot/src/plugin-compatibility.ts (dsh-v0.2.1-rc.2),
 * MIT License, Copyright (c) 2026 DeepSeek; see NOTICE.md.
 */
import semver from 'semver'

const DSH_PEER = /^@deepseek-ai\/dsh(?:-|$)/u
/** Ranges that installation reads as the running DSH version. */
const CURRENT_DSH = new Set(['workspace:*', 'workspace:^', 'workspace:~'])
/** Most `||` alternatives the conjunction of DSH peer ranges may produce. */
const MAX_RANGE_ALTERNATIVES = 256

/** Lifecycle scripts npm and pnpm run when a package is installed from a registry. */
export const INSTALL_LIFECYCLE_SCRIPTS = ['preinstall', 'install', 'postinstall']

/**
 * OSI-approved licenses accepted by the index, as SPDX ids (https://opensource.org/licenses).
 * Extend this list in a reviewed pull request when a plugin needs another OSI-approved license.
 */
export const OSI_LICENSES = new Set([
  '0BSD', 'AFL-3.0', 'AGPL-3.0', 'AGPL-3.0-only', 'AGPL-3.0-or-later', 'Apache-2.0', 'Artistic-2.0', 'BSD-1-Clause',
  'BSD-2-Clause', 'BSD-2-Clause-Patent', 'BSD-3-Clause', 'BSL-1.0', 'CDDL-1.0', 'EPL-1.0', 'EPL-2.0', 'EUPL-1.2',
  'GPL-2.0', 'GPL-2.0-only', 'GPL-2.0-or-later', 'GPL-3.0', 'GPL-3.0-only', 'GPL-3.0-or-later', 'ISC',
  'LGPL-2.1', 'LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-3.0', 'LGPL-3.0-only', 'LGPL-3.0-or-later', 'MIT', 'MIT-0',
  'MPL-2.0', 'MulanPSL-2.0', 'NCSA', 'OFL-1.1', 'PostgreSQL', 'PSF-2.0', 'Python-2.0', 'UPL-1.0', 'Unlicense', 'Zlib',
])

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse a `package.json`.
 * @param {Buffer | undefined} bytes - file contents.
 * @returns {object | undefined} the parsed object, or undefined when absent or not a JSON object.
 */
export function parseManifest(bytes) {
  if (bytes === undefined) return undefined
  try {
    const value = JSON.parse(bytes.toString('utf8'))
    return isObject(value) ? value : undefined
  } catch {
    // A malformed manifest declares no package.
    return undefined
  }
}

/**
 * @param {object | undefined} manifest - parsed manifest.
 * @returns {boolean} true when `dsh.bundle.patch` is a string or an array of strings.
 */
export function isBundle(manifest) {
  const bundle = manifest?.dsh?.bundle
  if (!isObject(bundle)) return false
  return typeof bundle.patch === 'string' || (Array.isArray(bundle.patch) && bundle.patch.every(file => typeof file === 'string'))
}

const validRange = range => range !== '' && !range.startsWith('workspace:') && semver.validRange(range) !== null

/**
 * The `engines.dsh` range an index lists for a manifest: its own `engines.dsh`, otherwise the conjunction of its
 * `@deepseek-ai/dsh` and `@deepseek-ai/dsh-*` peer ranges (`workspace:*|^|~` and `*` impose nothing).
 * @param {object} manifest - the version's manifest.
 * @returns {string | undefined | Error} the range, undefined for any DSH version, or why installation would refuse
 *   the version on every DSH version.
 */
export function dshRange(manifest) {
  const declared = isObject(manifest.engines) ? manifest.engines.dsh : undefined
  const ranges = typeof declared === 'string' ? [declared]
    : Object.entries(isObject(manifest.peerDependencies) ? manifest.peerDependencies : {})
      .flatMap(([name, range]) => DSH_PEER.test(name) && typeof range === 'string' && !CURRENT_DSH.has(range) ? [range] : [])
  const used = [...new Set(ranges.map(range => range.trim()))].filter(range => range !== '*')
  if (used.length === 0) return undefined
  let combinations = [[]]
  for (const range of used) {
    if (!validRange(range)) return new Error(`DSH range ${JSON.stringify(range)} is not a valid SemVer range`)
    const alternatives = new semver.Range(range, { includePrerelease: true }).set
      .map(set => set.map(comparator => comparator.value).filter(Boolean))
    if (combinations.length * alternatives.length > MAX_RANGE_ALTERNATIVES) {
      return new Error(`DSH peer ranges combine into more than ${MAX_RANGE_ALTERNATIVES} alternatives`)
    }
    combinations = combinations.flatMap(prefix => alternatives.map(alternative => [...new Set([...prefix, ...alternative])]))
      .filter(combination => semver.minVersion(new semver.Range(combination.join(' ') || '*', { includePrerelease: true })) !== null)
  }
  if (combinations.length === 0) return new Error(`no DSH version satisfies ${used.length === 1 ? 'the DSH range' : 'every DSH peer range'}: ${used.join(', ')}`)
  const written = [...new Set(combinations.map(combination => combination.join(' ') || '*'))]
  if (written.includes('*')) return undefined
  return used.length === 1 ? used[0] : written.join(' || ')
}

/**
 * Whether a DSH runtime satisfies a range the way DSH evaluates it (prereleases participate).
 * @param {string} runtimeVersion - exact DSH version.
 * @param {string} range - SemVer range.
 * @returns {boolean} whether the range admits the runtime.
 */
export function dshSatisfies(runtimeVersion, range) {
  return range.trim() !== '' && semver.satisfies(runtimeVersion, range, { includePrerelease: true })
}

/**
 * DSH's install-time check of a manifest: `engines.dsh` decides alone; otherwise every `@deepseek-ai/dsh` and
 * `@deepseek-ai/dsh-*` peer must admit the runtime (`workspace:^|~|*` mean the runtime itself).
 * @param {object} manifest - the installed package.json.
 * @param {string} runtimeVersion - exact DSH version.
 * @returns {Record<string, string>} unmet requirements, keyed `engines.dsh` or by peer name; empty when compatible.
 */
export function unmetDshRequirements(manifest, runtimeVersion) {
  const engines = isObject(manifest.engines) ? manifest.engines : {}
  if (Object.hasOwn(engines, 'dsh')) {
    const range = engines.dsh
    if (typeof range !== 'string') return { 'engines.dsh': String(range) }
    return dshSatisfies(runtimeVersion, range) ? {} : { 'engines.dsh': range }
  }
  const unmet = {}
  for (const [name, range] of Object.entries(isObject(manifest.peerDependencies) ? manifest.peerDependencies : {})) {
    if (name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')) continue
    if (typeof range !== 'string') { unmet[name] = String(range); continue }
    const requirement = CURRENT_DSH.has(range) ? runtimeVersion : range
    if (!dshSatisfies(runtimeVersion, requirement)) unmet[name] = range
  }
  return unmet
}

/**
 * Whether a manifest states any DSH requirement at all.
 * @param {object} manifest - parsed manifest.
 * @returns {boolean} true with `engines.dsh` or at least one DSH peer.
 */
export function declaresDsh(manifest) {
  if (isObject(manifest.engines) && Object.hasOwn(manifest.engines, 'dsh')) return true
  return Object.keys(isObject(manifest.peerDependencies) ? manifest.peerDependencies : {}).some(name => DSH_PEER.test(name))
}

/**
 * Install-time scripts of a package: registry lifecycle scripts, and the implicit `node-gyp rebuild` that npm and
 * pnpm run for a root `binding.gyp` without an install script.
 * @param {object} manifest - parsed manifest.
 * @param {{ file(path: string): unknown }} files - the package files.
 * @returns {string[]} script names, `binding.gyp` for the implicit one.
 */
export function installScripts(manifest, files) {
  const scripts = isObject(manifest.scripts) ? manifest.scripts : {}
  const found = INSTALL_LIFECYCLE_SCRIPTS.filter(name => typeof scripts[name] === 'string' && scripts[name].trim() !== '')
  if (files.file('binding.gyp') !== undefined && !found.includes('install') && !found.includes('preinstall')) found.push('binding.gyp')
  return found
}

/**
 * Check an SPDX license expression against OSI_LICENSES: `OR` needs one accepted alternative, `AND` needs all.
 * @param {unknown} expression - manifest `license`.
 * @returns {boolean} whether the expression grants an OSI-approved license.
 */
export function isOsiLicense(expression) {
  if (typeof expression !== 'string' || expression.trim() === '') return false
  const text = expression.trim().replace(/^\((.*)\)$/u, '$1')
  if (/\bOR\b/u.test(text)) return text.split(/\s+OR\s+/u).some(part => isOsiLicense(part))
  if (/\bAND\b/u.test(text)) return text.split(/\s+AND\s+/u).every(part => isOsiLicense(part))
  return OSI_LICENSES.has(text.replace(/\+$/u, '').replace(/\s+WITH\s+.+$/u, ''))
}
