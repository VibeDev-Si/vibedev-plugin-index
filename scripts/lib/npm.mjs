/**
 * npm registry reads: the registry document of a package and the verified tarball of one exact version.
 * Tarballs are bounded, checked against their subresource integrity, and unpacked in memory.
 * Adapted from DeepSeek Harness apps/plugin-market-generator/src/fetchers.ts (dsh-v0.2.1-rc.2),
 * MIT License, Copyright (c) 2026 DeepSeek; see NOTICE.md.
 */
import { createHash, getHashes } from 'node:crypto'
import { PackageFiles } from './package-files.mjs'
import { parseManifest } from './manifest.mjs'
import { readTarball } from './tar.mjs'

/** The public registry the index is checked against; clients install from their own configured registry. */
export const PUBLIC_REGISTRY = 'https://registry.npmjs.org/'

const ATTEMPTS = 3

async function fetchWithRetry(url, init, label) {
  let lastError
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, init())
      if (response.status === 404) return response
      if (response.ok) return response
      lastError = new Error(`${label}: HTTP ${response.status}`)
      await response.body?.cancel()
      if (response.status < 500 && response.status !== 429) break
    } catch (error) {
      lastError = new Error(`${label}: ${error.cause?.message ?? error.message}`)
    }
    await new Promise(resolve => setTimeout(resolve, 500 * attempt))
  }
  throw lastError
}

/**
 * Read the full registry document of a package.
 * @param {string} name - package name.
 * @param {{ registry?: string, timeoutMs: number }} options - registry base URL ending in `/`, request deadline.
 * @returns {Promise<object | undefined>} the document, or undefined when the registry does not know the package.
 */
export async function fetchPackument(name, { registry = PUBLIC_REGISTRY, timeoutMs }) {
  const url = new URL(name.replace('/', '%2f'), registry)
  const response = await fetchWithRetry(url, () => ({ signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } }), name)
  if (response.status === 404) return undefined
  return await response.json()
}

/**
 * @param {Uint8Array} bytes - file contents.
 * @param {string} integrity - subresource-integrity string such as `sha512-…`.
 * @returns {boolean} whether `bytes` match one supported hash of `integrity`.
 */
export function integrityMatches(bytes, integrity) {
  const supported = new Set(getHashes())
  const hashes = integrity.trim().split(/\s+/u).map(token => /^(sha\d+)-([A-Za-z0-9+/=]+)$/u.exec(token)).filter(match => match !== null)
  const usable = hashes.filter(([, algorithm]) => supported.has(algorithm))
  return usable.length > 0 && usable.some(([, algorithm, digest]) => createHash(algorithm).update(bytes).digest('base64') === digest)
}

/**
 * Download, verify, and unpack one exact version.
 * @param {string} name - package name.
 * @param {string} version - exact version.
 * @param {{ tarball?: string }} dist - the version's registry `dist` fields.
 * @param {string} integrity - the integrity the tarball must match.
 * @param {{ timeoutMs: number, maxTarballBytes: number, maxUnpackedBytes: number }} limits - deadline and bounds.
 * @returns {Promise<{ files: PackageFiles, manifest: object, tarballBytes: number }>} the package files and manifest.
 */
export async function fetchTarball(name, version, dist, integrity, limits) {
  const label = `${name}@${version}`
  if (typeof dist?.tarball !== 'string') throw new Error(`${label}: registry lists no tarball`)
  const response = await fetchWithRetry(dist.tarball, () => ({ signal: AbortSignal.timeout(limits.timeoutMs) }), `${label} tarball`)
  if (!response.ok) throw new Error(`${label}: tarball answered HTTP ${response.status}`)
  const chunks = []
  let total = 0
  for await (const chunk of response.body) {
    total += chunk.length
    if (total > limits.maxTarballBytes) throw new Error(`${label}: tarball exceeds ${limits.maxTarballBytes} bytes`)
    chunks.push(chunk)
  }
  const bytes = Buffer.concat(chunks)
  if (!integrityMatches(bytes, integrity)) throw new Error(`${label}: tarball does not match integrity ${integrity}`)
  const files = PackageFiles.fromTarball(readTarball(bytes, { maxBytes: limits.maxUnpackedBytes }))
  const manifest = parseManifest(files.read('package.json'))
  if (manifest?.name !== name || manifest.version !== version) throw new Error(`${label}: tarball package.json does not name ${label}`)
  return { files, manifest, tarballBytes: bytes.length }
}
