#!/usr/bin/env node
/**
 * Report versions of listed plugins published after the newest reviewed version. The report is input for a human
 * review; nothing is added to plugins.yml. Facts come from the registry document (the review re-checks the tarball).
 *
 * Usage: node scripts/check-updates.mjs [--catalog plugins.yml] [--output report.md] [--count-file count.txt]
 * Exit status: 0 when the check ran (with or without new versions), 1 when the list or a registry read failed.
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import semver from 'semver'
import { loadCatalog } from './lib/catalog.mjs'
import { dshRange, dshSatisfies, isBundle, isOsiLicense, unmetDshRequirements } from './lib/manifest.mjs'
import { fetchPackument } from './lib/npm.mjs'

const { values } = parseArgs({ options: { catalog: { type: 'string', default: 'plugins.yml' }, output: { type: 'string' }, 'count-file': { type: 'string' } } })
const { catalog, errors } = loadCatalog(resolve(values.catalog))
if (errors.length > 0) {
  for (const message of errors) console.error(`error: ${message}`)
  process.exit(1)
}
const target = catalog.target.dsh
const rows = []
const failures = []
for (const plugin of catalog.plugins) {
  const listed = plugin.versions.map(entry => entry.version)
  const newest = semver.rsort([...listed])[0]
  let packument
  try {
    packument = await fetchPackument(plugin.name, { timeoutMs: 60_000 })
  } catch (error) {
    failures.push(`${plugin.name}: ${error.message}`)
    continue
  }
  if (packument === undefined) {
    failures.push(`${plugin.name}: no longer published on npm`)
    continue
  }
  for (const [version, manifest] of Object.entries(packument.versions ?? {})) {
    if (semver.valid(version) === null || !semver.gt(version, newest)) continue
    const range = dshRange(manifest)
    const discover = !(range instanceof Error) && (range === undefined || dshSatisfies(target, range))
    const install = Object.keys(unmetDshRequirements(manifest, target)).length === 0
    rows.push({
      name: plugin.name, listed: listed.join(', '), version,
      published: String(packument.time?.[version] ?? '').slice(0, 10),
      latest: packument['dist-tags']?.latest === version,
      deprecated: typeof manifest.deprecated === 'string' && manifest.deprecated !== '',
      bundle: isBundle(manifest),
      engines: range instanceof Error ? `invalid (${range.message})` : range ?? '(any)',
      compatible: discover && install,
      installScript: manifest.hasInstallScript === true,
      unpacked: manifest.dist?.unpackedSize,
      license: manifest.license ?? null,
      osi: isOsiLicense(manifest.license),
    })
  }
}
rows.sort((left, right) => left.name.localeCompare(right.name) || semver.compare(left.version, right.version))

const yes = flag => (flag ? 'yes' : '**no**')
const lines = [
  `## Upstream releases awaiting review · 待审核的上游新版本`,
  '',
  `Weekly check of \`${values.catalog}\` against npm, target DSH \`${target}\`, run ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
  'Nothing below reaches the index until a reviewer completes the checklist and a pull request records the exact version and integrity in `plugins.yml`.',
  '以下版本不会自动收录：需要审核人按清单复审，并通过 PR 把精确版本和 integrity 写进 `plugins.yml`。',
  '',
]
if (rows.length === 0) lines.push(catalog.plugins.length === 0 ? 'No plugins are listed yet. 尚未收录插件。' : 'Every listed plugin is at its newest published version. 所有收录插件都已是最新版本。')
else {
  lines.push('| Package | Listed | New version | Published | npm latest | Bundle | engines.dsh | Compatible with target | Install script | Unpacked | License (OSI) | Deprecated |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const row of rows) {
    const size = row.unpacked === undefined ? '?' : `${Math.round(row.unpacked / 1024)} KiB`
    lines.push(`| \`${row.name}\` | ${row.listed} | \`${row.version}\` | ${row.published} | ${row.latest ? 'yes' : ''} | ${yes(row.bundle)} | \`${row.engines.replaceAll('|', '\\|')}\` | ${yes(row.compatible)} | ${row.installScript ? '**yes**' : 'no'} | ${size} | ${row.license ?? '?'} (${yes(row.osi)}) | ${row.deprecated ? '**yes**' : 'no'} |`)
  }
  lines.push('', 'Review one version with `npm run inspect -- <name>@<version> --deps`; see README → 审核清单 / Review checklist.')
}
if (failures.length > 0) lines.push('', '### Registry problems', ...failures.map(message => `- ${message}`))
const report = `${lines.join('\n')}\n`
if (values.output !== undefined) writeFileSync(values.output, report)
else process.stdout.write(report)
if (values['count-file'] !== undefined) writeFileSync(values['count-file'], `${rows.length + failures.length}\n`)
console.error(`check-updates: ${rows.length} new version(s), ${failures.length} registry problem(s)`)
process.exit(failures.length > 0 ? 1 : 0)
