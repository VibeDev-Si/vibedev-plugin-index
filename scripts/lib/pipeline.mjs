/**
 * One pass over the curated list: check every listed version against npm and the inclusion rules, then assemble the
 * format-1 index from the allowed versions only. Display fields come from the highest *allowed* version, so an
 * unreviewed release never contributes text or icons.
 * The release selection and entry assembly follow DeepSeek Harness apps/plugin-market-generator/src/generate.ts
 * (dsh-v0.2.1-rc.2), MIT License, Copyright (c) 2026 DeepSeek; see NOTICE.md.
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { MarketIndexError, parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'
import semver from 'semver'
import { CAPABILITY_LABELS, loadCatalog } from './catalog.mjs'
import { readDisplayMetadata } from './display.mjs'
import {
  declaresDsh, dshRange, dshSatisfies, installScripts, isBundle, isOsiLicense, unmetDshRequirements,
} from './manifest.mjs'
import { fetchPackument, fetchTarball, PUBLIC_REGISTRY } from './npm.mjs'

/** Hard bounds for reading one tarball; the inclusion size rule is `policy.maxUnpackedBytes`. */
export const READ_LIMITS = { timeoutMs: 60_000, maxTarballBytes: 64 * 1024 * 1024, maxUnpackedBytes: 256 * 1024 * 1024 }
/** Base URL used only to validate relative icon references. */
const VALIDATION_URL = 'https://index.invalid/index.json'
const LICENSE_FILE = /^(?:licen[cs]e|copying)(?:[.-].*)?$/iu

async function mapLimited(items, limit, work) {
  const results = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const position = next++
      results[position] = await work(items[position], position)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** Capability labels a review implies. */
function capabilityLabels(review) {
  const { network, files, config, childProcess } = review.capabilities
  return [
    ...network.length > 0 ? ['network'] : [],
    ...childProcess.length > 0 ? ['child-process'] : [],
    ...files === 'write' ? ['writes-files'] : [],
    ...config === 'write' ? ['writes-config'] : [],
    ...review.installScripts.length > 0 ? ['install-scripts'] : [],
  ]
}

/** Check one listed version and build its index record; problems go to `report`. */
async function checkVersion(plugin, listed, packument, catalog, report) {
  const label = `${plugin.name}@${listed.version}`
  // Both return undefined, so `return error(…)` ends the check without a record.
  const error = (message) => { report.errors.push(`${label}: ${message}`) }
  const warn = (message) => { report.warnings.push(`${label}: ${message}`) }
  const published = packument.versions?.[listed.version]
  if (published === undefined) return error('is not published on npm')
  if (published.dist?.integrity !== listed.integrity) return error(`integrity does not match npm (npm reports ${published.dist?.integrity ?? 'none'})`)
  if (typeof published.deprecated === 'string' && published.deprecated !== '') error(`is deprecated on npm: ${published.deprecated}`)
  const time = packument.time?.[listed.version]
  if (typeof time !== 'string' || Number.isNaN(Date.parse(time))) return error('has no publish time on npm')
  let tarball
  try {
    tarball = await fetchTarball(plugin.name, listed.version, published.dist, listed.integrity, READ_LIMITS)
  } catch (failure) {
    return error(failure.message)
  }
  const { files, manifest } = tarball
  const { review } = listed
  const target = catalog.target.dsh
  if (!isBundle(manifest)) error('package.json declares no dsh.bundle patch, so it is not an installable DSH bundle')
  if (!isOsiLicense(manifest.license)) error(`license ${JSON.stringify(manifest.license ?? null)} is not an accepted OSI-approved SPDX license`)
  if (manifest.license !== review.license) error(`review.license ${JSON.stringify(review.license)} differs from package.json license ${JSON.stringify(manifest.license ?? null)}`)
  if (!files.fileNames('').some(name => LICENSE_FILE.test(name))) warn('the package contains no LICENSE file')
  if (files.bytes > catalog.policy.maxUnpackedBytes && review.sizeException === undefined) {
    error(`unpacks to ${files.bytes} bytes, over policy.maxUnpackedBytes ${catalog.policy.maxUnpackedBytes}; add review.sizeException with the reason if accepted`)
  }
  const scripts = installScripts(manifest, files)
  const unreviewed = scripts.filter(name => !review.installScripts.includes(name))
  if (unreviewed.length > 0) error(`has unreviewed install scripts: ${unreviewed.join(', ')}`)
  const stale = review.installScripts.filter(name => !scripts.includes(name))
  if (stale.length > 0) warn(`review.installScripts lists ${stale.join(', ')}, which the package does not have`)
  if (published.hasInstallScript === true && scripts.length === 0) warn('npm reports hasInstallScript, but no install script was found in the tarball')
  const range = dshRange(manifest)
  if (range instanceof Error) error(`${range.message}; DSH would refuse it on every version`)
  else if (range !== undefined && !dshSatisfies(target, range)) error(`engines.dsh ${JSON.stringify(range)} does not admit the target DSH ${target}`)
  const unmet = unmetDshRequirements(manifest, target)
  if (Object.keys(unmet).length > 0) error(`DSH ${target} would refuse installation: unmet ${JSON.stringify(unmet)}`)
  if (!review.testedOn.includes(target)) {
    if (declaresDsh(manifest)) warn(`review.testedOn does not include the target DSH ${target}`)
    else error(`declares no DSH requirement (no engines.dsh, no @deepseek-ai/dsh-* peer) and review.testedOn does not include the target DSH ${target}`)
  }
  if (manifest.repository === undefined) warn('package.json names no source repository')
  return {
    label, files, manifest, review,
    facts: {
      version: listed.version, license: manifest.license, unpackedBytes: files.bytes, fileCount: files.count,
      tarballBytes: tarball.tarballBytes, engines: range instanceof Error ? null : range ?? null, installScripts: scripts,
      published: time,
    },
    release: {
      version: listed.version,
      publishTimestamp: Math.floor(Date.parse(time) / 1000),
      source: { type: 'npm' },
      ...typeof range === 'string' ? { engines: { dsh: range } } : {},
    },
  }
}

async function checkPlugin(plugin, catalog, report, registry) {
  let packument
  try {
    packument = await fetchPackument(plugin.name, { registry, timeoutMs: READ_LIMITS.timeoutMs })
  } catch (failure) {
    report.errors.push(`${plugin.name}: registry read failed: ${failure.message}`)
    return undefined
  }
  if (packument === undefined) {
    report.errors.push(`${plugin.name}: is not published on npm`)
    return undefined
  }
  const checked = []
  for (const listed of plugin.versions) {
    const result = await checkVersion(plugin, listed, packument, catalog, report)
    if (result !== undefined) checked.push(result)
  }
  if (checked.length !== plugin.versions.length) return undefined
  const sorted = [...checked].sort((left, right) => semver.rcompare(left.release.version, right.release.version))
  const highest = sorted[0]
  const { display, iconFile } = readDisplayMetadata(highest.files, highest.manifest, {
    inlineBytes: catalog.policy.inlineIconBytes,
    warn: message => report.warnings.push(`${highest.label}: ${message}`),
  })
  const labels = [...new Set([...plugin.tags, ...checked.flatMap(item => capabilityLabels(item.review))])]
  const stable = sorted.find(item => semver.prerelease(item.release.version) === null) ?? highest
  const { keywords, ...shown } = display
  const entry = {
    name: plugin.name,
    ...shown,
    ...plugin.display?.title === undefined ? {} : { title: plugin.display.title },
    ...plugin.display?.description === undefined ? {} : { description: plugin.display.description },
    metadata: { category: plugin.category, labels, ...keywords === undefined ? {} : { keywords } },
    'dist-tags': { latest: stable.release.version },
    versions: sorted.map(item => item.release),
  }
  const order = ['name', 'title', 'description', 'icon', 'author', 'homepage', 'repository', 'metadata', 'dist-tags', 'versions']
  return {
    entry: Object.fromEntries(order.flatMap(key => Object.hasOwn(entry, key) ? [[key, entry[key]]] : [])),
    iconFile,
    facts: { name: plugin.name, category: plugin.category, labels, latest: stable.release.version, versions: checked.map(item => item.facts) },
  }
}

/**
 * Check a curated list and assemble its index.
 * @param {string} catalogFile - path of the source list.
 * @param {{ registry?: string, concurrency?: number }} [options] - registry to check against, parallel plugins.
 * @returns {Promise<{ errors: string[], warnings: string[], index?: object, icons: Map<string, Buffer>, facts: object[], catalog?: object }>}
 *   every violation, and the index when there is none.
 */
export async function runPipeline(catalogFile, { registry = PUBLIC_REGISTRY, concurrency = 4 } = {}) {
  const { catalog, errors } = loadCatalog(catalogFile)
  const report = { errors: [...errors], warnings: [] }
  if (report.errors.length > 0) return { ...report, icons: new Map(), facts: [], catalog }
  const results = await mapLimited(catalog.plugins, concurrency, plugin => checkPlugin(plugin, catalog, report, registry))
  const icons = new Map()
  for (const result of results) if (result?.iconFile !== undefined) icons.set(result.iconFile.path, result.iconFile.bytes)
  const declarations = entries => Object.fromEntries(Object.entries(entries).map(([id, title]) => [id, { title }]))
  const index = {
    format: 1,
    title: catalog.index.title,
    ...catalog.index.description === undefined ? {} : { description: catalog.index.description },
    metadata: {
      categories: declarations(catalog.categories),
      labels: { ...declarations(catalog.labels ?? {}), ...CAPABILITY_LABELS },
    },
    plugins: results.flatMap(result => result === undefined ? [] : [result.entry]),
  }
  try {
    parseMarketIndex(JSON.parse(JSON.stringify(index)), VALIDATION_URL)
  } catch (failure) {
    if (!(failure instanceof MarketIndexError)) throw failure
    report.errors.push(`generated index violates format 1 (@deepseek-ai/dsh-plugin-market-index): ${failure.message}`)
  }
  for (const plugin of index.plugins) {
    const target = plugin['dist-tags'].latest
    if (!plugin.versions.some(version => version.version === target)) report.errors.push(`${plugin.name}: dist-tags.latest ${target} is not a listed version`)
  }
  // Lists kept beside a reviews/ directory (the production list) expect a review record for every listed version.
  const reviews = join(dirname(catalogFile), 'reviews')
  if (existsSync(reviews)) {
    for (const plugin of catalog.plugins) {
      for (const { version } of plugin.versions) {
        if (!existsSync(join(reviews, `${plugin.name}@${version}.md`))) {
          report.warnings.push(`${plugin.name}@${version}: no review record reviews/${plugin.name}@${version}.md; create it with npm run review -- ${plugin.name}@${version} --dsh <DSH checkout>`)
        }
      }
    }
  }
  return { ...report, icons, facts: results.flatMap(result => result === undefined ? [] : [result.facts]), catalog, ...report.errors.length === 0 ? { index } : {} }
}
