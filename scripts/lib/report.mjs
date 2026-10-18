/** Console and GitHub job-summary output of a pipeline run. */
import { appendFileSync } from 'node:fs'

const kib = bytes => `${(bytes / 1024).toFixed(0)} KiB`

/**
 * Print errors, warnings, and the listed versions; append the same as Markdown to `$GITHUB_STEP_SUMMARY` when set.
 * @param {{ errors: string[], warnings: string[], facts: object[], catalog?: object }} result - a pipeline result.
 * @param {string} title - heading of the summary.
 */
export function printReport(result, title) {
  for (const message of result.errors) console.error(`error: ${message}`)
  for (const message of result.warnings) console.error(`warning: ${message}`)
  const rows = result.facts.flatMap(plugin => plugin.versions.map(version => [
    plugin.name, version.version, version.license, version.engines ?? '(any)', kib(version.unpackedBytes),
    version.installScripts.join(', ') || 'none', version.published.slice(0, 10),
  ]))
  const target = result.catalog?.target?.dsh ?? '?'
  console.log(`${title}: target DSH ${target}; ${result.facts.length} plugin(s), ${rows.length} version(s); ${result.errors.length} error(s), ${result.warnings.length} warning(s)`)
  for (const row of rows) console.log(`  ${row[0]}@${row[1]}  license=${row[2]}  engines.dsh=${row[3]}  size=${row[4]}  installScripts=${row[5]}  published=${row[6]}`)
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (summary === undefined || summary === '') return
  const lines = [
    `### ${title}`, '',
    `Target DSH \`${target}\` · ${result.facts.length} plugin(s) · ${rows.length} version(s) · ${result.errors.length} error(s) · ${result.warnings.length} warning(s)`, '',
  ]
  if (rows.length > 0) {
    lines.push('| Package | Version | License | engines.dsh | Unpacked | Install scripts | Published |', '|---|---|---|---|---|---|---|')
    for (const row of rows) lines.push(`| \`${row[0]}\` | ${row.slice(1).map(cell => `\`${String(cell).replaceAll('|', '\\|')}\``).join(' | ')} |`)
    lines.push('')
  }
  for (const message of result.errors) lines.push(`- ❌ ${message}`)
  for (const message of result.warnings) lines.push(`- ⚠️ ${message}`)
  appendFileSync(summary, `${lines.join('\n')}\n`)
}
