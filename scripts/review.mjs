#!/usr/bin/env node
/**
 * One command per review: static inspection (tarball, provenance, dependency tree, code hints), an isolated install
 * trial on a built DSH checkout (installBundle in a temporary profile, restart, child processes, outbound requests,
 * credential reads, registrations), and a review record: reviews/<name>@<version>.md (Chinese first, then English)
 * with a draft plugins.yml entry, plus the facts in reviews/<name>@<version>.json. With --previous the record also
 * compares the two versions, so an update needs only the delta reviewed; the previous version's trial facts come from
 * its committed record when there is one.
 *
 * Usage: npm run review -- <name>@<version> [--previous <version>] [--dsh <DSH checkout>] [--pnpm <pnpm.mjs>]
 *        [--call "METHOD /path"]... [--no-trial] [--force] [--out reviews]
 * DSH_CHECKOUT and PNPM_MJS stand in for --dsh and --pnpm; --pnpm defaults to the pnpm bundled with VibeDev.
 * Without a DSH checkout the trial is skipped and the record says so.
 */
import { execFileSync, spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { loadCatalog } from './lib/catalog.mjs'
import { inspectVersion } from './lib/inspection.mjs'
import { compareFacts, diffFiles, draftEntry, FACTS_SCHEMA, renderRecord, summarizeTrial } from './lib/review-record.mjs'

const repo = fileURLToPath(new URL('..', import.meta.url))
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    previous: { type: 'string' }, dsh: { type: 'string' }, pnpm: { type: 'string' }, call: { type: 'string', multiple: true },
    'no-trial': { type: 'boolean', default: false }, force: { type: 'boolean', default: false },
    out: { type: 'string', default: 'reviews' }, settle: { type: 'string', default: '12000' }, catalog: { type: 'string', default: 'plugins.yml' },
  },
})
const usage = 'usage: npm run review -- <name>@<version> [--previous <version>] [--dsh <DSH checkout>] [--pnpm <pnpm.mjs>] [--call "METHOD /path"]... [--no-trial] [--force]'
if (positionals.length !== 1) {
  console.error(usage)
  process.exit(2)
}
const at = positionals[0].lastIndexOf('@')
const name = at > 0 ? positionals[0].slice(0, at) : positionals[0]
const requested = at > 0 ? positionals[0].slice(at + 1) : undefined
const calls = values.call ?? []
const outDir = resolve(repo, values.out)
const { catalog } = loadCatalog(resolve(repo, values.catalog))
const target = catalog?.target?.dsh
if (typeof target !== 'string') {
  console.error(`${values.catalog} has no target.dsh`)
  process.exit(2)
}
const today = new Date().toLocaleDateString('sv-SE')

// ---- the trial environment ---------------------------------------------------------------------------------------
const dsh = values.dsh ?? process.env.DSH_CHECKOUT
const bundledPnpm = join(homedir(), '.vibedev-app', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.mjs')
const pnpm = values.pnpm ?? process.env.PNPM_MJS ?? (existsSync(bundledPnpm) ? bundledPnpm : undefined)
const trialBlocker = values['no-trial'] ? 'disabled with --no-trial'
  : dsh === undefined ? 'no DSH checkout (--dsh or DSH_CHECKOUT)'
    : !existsSync(join(dsh, 'apps', 'cli', 'lib', 'profile-boot.js')) ? `${dsh} has no built apps/cli/lib/profile-boot.js`
      : pnpm === undefined || !existsSync(pnpm) ? 'no pnpm.mjs (--pnpm or PNPM_MJS)' : undefined
const trialScript = fileURLToPath(new URL('../test/dsh-composition/install-trial.mjs', import.meta.url))

function git(cwd, args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    // Not a Git checkout: the record names no commit.
    return undefined
  }
}

/** Run the install trial for one exact version in a child process and summarize its log. */
async function runTrial(spec) {
  if (trialBlocker !== undefined) return { skipped: trialBlocker }
  const work = mkdtempSync(join(tmpdir(), 'vibedev-review-'))
  const out = join(work, 'trial.json')
  const logFile = join(work, 'trial.log')
  const args = [trialScript, '--dsh', resolve(dsh), '--pnpm', resolve(pnpm), '--settle', values.settle, '--out', out, ...calls.flatMap(call => ['--call', call]), spec]
  const fd = openSync(logFile, 'w')
  const status = await new Promise((done) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', fd, fd], windowsHide: true })
    const timer = setTimeout(() => { child.kill() }, 15 * 60_000)
    child.on('exit', (code) => { clearTimeout(timer); done(code) })
    child.on('error', () => { clearTimeout(timer); done(-1) })
  })
  closeSync(fd)
  const raw = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : undefined
  const tail = readFileSync(logFile, 'utf8').split(/\r?\n/u).filter(line => !/token=/u.test(line)).slice(-12).join('\n')
  rmSync(work, { recursive: true, force: true, maxRetries: 3 })
  if (raw === undefined) {
    console.error(`trial for ${spec} exited with ${status} and wrote no report; log tail:\n${tail}`)
    return { skipped: `the trial harness exited with ${status} without a report` }
  }
  return summarizeTrial(raw, { names: [name] })
}

const step = message => console.log(`• ${message}`)

// ---- current version ---------------------------------------------------------------------------------------------
step(`static inspection of ${name}@${requested ?? 'latest'}`)
let current
try {
  current = await inspectVersion(name, requested, { target, deps: true })
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
const { report } = current
const version = report.version
const recordPath = join(outDir, `${name}@${version}.md`)
const factsPath = join(outDir, `${name}@${version}.json`)
if (existsSync(recordPath) && !values.force) {
  console.error(`${relative(repo, recordPath)} exists; pass --force to regenerate it (human edits in it are lost)`)
  process.exit(2)
}
step(trialBlocker === undefined ? `install trial of ${name}@${version} on ${dsh}` : `install trial skipped: ${trialBlocker}`)
const trial = await runTrial(`${name}@${version}`)

// ---- previous version --------------------------------------------------------------------------------------------
let delta
let previousTrialSource
if (values.previous !== undefined) {
  step(`static inspection of ${name}@${values.previous}`)
  const previous = await inspectVersion(name, values.previous, { target, deps: true })
  const previousFacts = join(outDir, `${name}@${values.previous}.json`)
  let previousTrial
  if (existsSync(previousFacts)) {
    const facts = JSON.parse(readFileSync(previousFacts, 'utf8'))
    if (facts.schema === FACTS_SCHEMA && facts.trial !== undefined && !facts.trial.skipped) {
      previousTrial = facts.trial
      previousTrialSource = relative(repo, previousFacts).replaceAll('\\', '/')
      step(`previous trial facts from ${previousTrialSource}`)
    }
  }
  if (previousTrial === undefined) {
    step(trialBlocker === undefined ? `install trial of ${name}@${values.previous}` : 'previous trial skipped')
    previousTrial = await runTrial(`${name}@${values.previous}`)
  }
  delta = compareFacts({ report: previous.report, trial: previousTrial }, { report, trial }, diffFiles(previous.files, current.files))
}

// ---- record ------------------------------------------------------------------------------------------------------
const plugin = catalog?.plugins?.find?.(item => item.name === name)
const listing = { plugin, version: plugin?.versions?.find(item => item.version === version) }
const draft = draftEntry({ report, trial, listing, categories: catalog.categories ?? {}, delta, previous: values.previous, today })
const quote = text => (/[\s"]/u.test(text) ? JSON.stringify(text) : text)
const command = ['npm run review --', `${name}@${version}`, ...values.previous ? ['--previous', values.previous] : [],
  ...dsh && !values['no-trial'] ? ['--dsh', quote(dsh)] : [], ...calls.flatMap(call => ['--call', quote(call)]), ...values['no-trial'] ? ['--no-trial'] : []].join(' ')
const steps = [
  `npm run inspect -- ${name}@${version} --deps --json`,
  ...values.previous ? [`npm run inspect -- ${name}@${values.previous} --deps --json`] : [],
  ...trialBlocker === undefined
    ? [`node test/dsh-composition/install-trial.mjs --dsh ${quote(dsh)} --pnpm <pnpm.mjs> --settle ${values.settle}${calls.map(call => ` --call ${quote(call)}`).join('')} --out trial.json ${name}@${version}`]
    : [],
  ...previousTrialSource ? [`# 上一版本的试用结果取自 · previous trial facts from ${previousTrialSource}`] : [],
]
// Review records themselves do not make the tool version dirty.
const dirty = (git(repo, ['status', '--porcelain', '--', '.', `:!${values.out}`]) ?? '') !== ''
const tool = {
  index: `${git(repo, ['rev-parse', '--short', 'HEAD']) ?? 'unknown'}${dirty ? '+changes' : ''}`,
  ...trialBlocker === undefined ? { dsh: `${git(dsh, ['rev-parse', '--short', 'HEAD']) ?? 'unknown'} (DSH ${trial.dshVersion ?? '?'})` } : {},
}
const markdown = renderRecord({ report, trial, listing, draft, delta, previous: values.previous, command, steps, tool, today })
const facts = {
  schema: FACTS_SCHEMA, package: name, version, date: today, target, command, tool,
  static: report, trial,
  ...delta ? { previous: { version: values.previous, highlights: delta.highlights, files: { added: delta.files.added.length, removed: delta.files.removed.length, changed: delta.files.changed.length } } } : {},
}
mkdirSync(dirname(recordPath), { recursive: true })
writeFileSync(recordPath, markdown)
writeFileSync(factsPath, `${JSON.stringify(facts, null, 2)}\n`)

// ---- summary -----------------------------------------------------------------------------------------------------
const ok = value => (value ? 'yes' : 'NO')
console.log(`\n${name}@${version}`)
console.log(`  license ${report.license} (OSI ${ok(report.licenseAccepted)}), DSH ${target}: Discover ${ok(report.compatibleInDiscover)}, install ${ok(report.compatibleAtInstall)}; install scripts ${report.installScripts.join(', ') || 'none'} (tree ${report.dependencyTree.withInstallScripts.join(', ') || 'none'}); ${Math.round(report.unpackedBytes / 1024)} KiB; provenance ${report.provenance ? 'yes' : 'none'}`)
console.log(trial.skipped
  ? `  trial: skipped (${trial.skipped})`
  : `  trial: ${trial.ok ? 'OK' : 'FAILED'}; processes ${trial.programs.join(', ') || 'none'}; connections outside install ${trial.connections.length}; credential reads ${trial.credentialReads.length}; calls ${trial.calls.length}`)
if (delta) console.log(`  changes since ${values.previous}: ${delta.highlights.join('; ') || 'none to look at'}`)
console.log(`  draft: ${draft.kind === 'listed' ? 'listed version (record of plugins.yml)' : draft.kind === 'update' ? 'new version of a listed plugin' : 'new plugin'}; TODO left: ${(draft.yaml.match(/TODO/gu) ?? []).length + (listing.version === undefined ? 2 : 0)} (verdict and risk notes in the record, values in the draft)`)
console.log(`  wrote ${relative(repo, recordPath)} and ${relative(repo, factsPath)}`)
