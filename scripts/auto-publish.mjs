#!/usr/bin/env node
/**
 * Take newer releases of plugins that opt in: first-party packages (`autoPublish: true`) and third-party packages with
 * an `autoFollow` block.
 *
 * Every taken release must pass every machine check the curated list applies: npm integrity, an installable
 * `dsh.bundle`, an OSI license matching the review, no install scripts, the size policy, and DSH compatibility; the
 * whole list, including the new versions, runs through the same pipeline before anything is written.
 *
 * First party: npm `latest` is taken when the npm account that published it and every npm maintainer are listed in
 * `firstParty.npmPublishers`, its repository is owned by `firstParty.repositoryOwner`, and it reaches no new host and
 * starts no new program compared with the previous listed version. Code review happens in the package's own pull
 * request before it is published.
 *
 * Third party (`autoFollow`, scripts/lib/auto-follow.mjs): the highest release within `autoFollow.updates` of the last
 * version a human reviewed is taken once it is `policy.autoFollowWaitHours` old, comes from the declared npm accounts
 * or provenance, and stays within the reviewed version's hosts, environment variables, code-hint categories,
 * dependencies and dependency tree. Its review entry carries over that version's capabilities and testedOn.
 *
 * Both: a package over the size limit may keep only the size exception of the last human-reviewed version, and only
 * while within SIZE_GROWTH_LIMIT of its size. New entries are inserted as text, so plugins.yml keeps every other byte.
 * A refused release is reported (--refusals-output, --refusals-count-file) and does not stop the others.
 *
 * Usage: node scripts/auto-publish.mjs [--catalog plugins.yml] [--apply] [--json]
 *        [--refusals-output refused.md] [--refusals-count-file refused-count.txt]
 * Exit status: 0 when every release was taken, waits, or was refused and reported; 1 when the registry or a tarball
 * could not be read or the list itself fails the checks (releases that passed are still written with --apply).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import semver from 'semver'
import { stringify } from 'yaml'
import { behaviorChanges, identityRefusal, selectRelease } from './lib/auto-follow.mjs'
import { loadCatalog } from './lib/catalog.mjs'
import { appendVersionText } from './lib/catalog-edit.mjs'
import { AUTOMATED_REVIEWER, automatedSizeException, firstPartyRefusal, humanReviewedBaseline } from './lib/first-party.mjs'
import { inspectVersion } from './lib/inspection.mjs'
import { fetchPackument } from './lib/npm.mjs'
import { runPipeline } from './lib/pipeline.mjs'

const { values } = parseArgs({
  options: {
    catalog: { type: 'string', default: 'plugins.yml' },
    apply: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    'refusals-output': { type: 'string' },
    'refusals-count-file': { type: 'string' },
  },
})
const catalogPath = resolve(values.catalog)
const now = Date.now()
const today = new Date(now).toISOString().slice(0, 10)
const log = (...parts) => { if (!values.json) console.log(...parts) }

function reviewPath(name, version) {
  return join('reviews', `${name}@${version}.md`)
}

/** The machine-check rows shared by both kinds of automated record. */
function factRows(facts) {
  return `| integrity | \`${facts.integrity}\` |
| 发布 · Published | ${facts.published} |
| 许可证 · License | ${facts.license} |
| bundle | ${facts.bundle ? '✅' : '❌'} |
| DSH 兼容 · DSH compatibility | ${facts.declaresDsh ? `${facts.enginesDsh ? 'engines.dsh' : 'dsh peers'} ${facts.indexEnginesDsh}` : 'no declaration; tested on the target DSH'} |
| 安装脚本 · Install scripts | ${facts.installScripts.length > 0 ? facts.installScripts.join(', ') : '无 · none'} |
| 体量 · Size | 解包 · unpacked ${Math.round(facts.unpackedBytes / 1024)} KiB，${facts.fileCount} 个文件 · files |
| 依赖 · Dependencies | ${Object.keys(facts.dependencies).length > 0 ? Object.entries(facts.dependencies).map(([name, range]) => `\`${name}\` ${range}`).join('、') : '无 · none'} |`
}

function firstPartyDocument({ plugin, previous, version, facts }) {
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
${factRows(facts)}

网络主机与子进程与上一版本一致 · Network hosts and child processes match the previous reviewed version：
${(facts.hosts ? Object.keys(facts.hosts) : []).join(', ') || '—'}
`
}

function autoFollowDocument({ plugin, baseline, version, facts, identity }) {
  const hours = catalog.policy.autoFollowWaitHours
  return `# 审核记录 · Review record：\`${plugin.name}@${version}\`

> 第三方插件，按 plugins.yml 的 \`autoFollow\` 规则自动收录：发布身份与声明一致，发布已满 ${hours} 小时且未弃用，与人工审核的
> \`${baseline.version}\` 相比没有新的主机、环境变量、代码线索类别、依赖或依赖树中的包，并重新通过了全部机器检查。没有做安装试用。
> Third-party auto-follow entry: the release comes from the declared identity, is at least ${hours} hours old and not
> deprecated, adds no host, environment variable, code-hint category, dependency or dependency-tree package to
> \`${baseline.version}\`, which a person reviewed, and passed every machine check again. It was not trial-installed.

## 结论 · Verdict

- 结论 · Verdict：**收 · include**（自动收录 · recorded automatically）
- 审核 · Review：VibeDev（自动 · automated），${today}；人工审核基线 · reviewed by hand：\`${baseline.version}\`（${baseline.review.date}）
- 沿用 · Carried over：\`${baseline.version}\` 的 capabilities、installScripts、testedOn 与风险提示。
  Capabilities, install scripts, testedOn and risk notes from \`${baseline.version}\`.

## 发布身份 · Release identity

${identity}

## 机器检查 · Machine checks

| 项目 · Item | 值 · Value |
|---|---|
${factRows(facts)}

代码中的主机 · Hosts in code：${Object.keys(facts.hosts ?? {}).join(', ') || '—'}
`
}

const { catalog, errors: structureErrors } = loadCatalog(catalogPath)
if (catalog === undefined || structureErrors.length > 0) {
  for (const error of structureErrors) console.error(error)
  process.exit(1)
}
const target = catalog.target.dsh
const maxUnpackedBytes = catalog.policy.maxUnpackedBytes

const pending = []
const refusals = []
const waiting = []
let failed = false

function refuse(name, version, reason) {
  console.error(`${name}@${version}: refused, ${reason}; review it by hand`)
  refusals.push({ name, version, reason })
}

function newestListed(plugin) {
  return plugin.versions.reduce((best, entry) => (semver.gt(entry.version, best.version) ? entry : best))
}

async function readPackument(plugin) {
  try {
    return await fetchPackument(plugin.name, { timeoutMs: 60_000 })
  } catch (failure) {
    console.error(`${plugin.name}: registry read failed: ${failure.message}`)
    failed = true
    return undefined
  }
}

async function inspect(name, version, deps) {
  try {
    return (await inspectVersion(name, version, { target, deps })).report
  } catch (failure) {
    console.error(`${name}@${version}: inspection failed: ${failure.message}`)
    failed = true
    return undefined
  }
}

async function sizeRule(plugin, version, facts, baseline, baselineFacts) {
  let baselineBytes = baselineFacts?.unpackedBytes
  if (facts.unpackedBytes > maxUnpackedBytes && baseline !== undefined && baselineBytes === undefined) {
    baselineBytes = (await inspect(plugin.name, baseline.version, false))?.unpackedBytes
  }
  return automatedSizeException({ bytes: facts.unpackedBytes, maxUnpackedBytes, baseline, baselineBytes })
}

async function takeFirstParty(plugin) {
  const previous = newestListed(plugin)
  const packument = await readPackument(plugin)
  if (packument === undefined) return
  const latest = packument?.['dist-tags']?.latest
  if (typeof latest !== 'string' || semver.valid(latest) !== latest || semver.prerelease(latest) !== null) {
    log(`${plugin.name}: no stable latest tag on npm, skipped`)
    return
  }
  if (!semver.gt(latest, previous.version)) {
    log(`${plugin.name}: up to date at ${previous.version}`)
    return
  }
  const notFirstParty = firstPartyRefusal(packument, latest, catalog.firstParty)
  if (notFirstParty !== undefined) return refuse(plugin.name, latest, notFirstParty)
  const facts = await inspect(plugin.name, latest, true)
  const before = await inspect(plugin.name, previous.version, false)
  if (facts === undefined || before === undefined) return
  const hostsBefore = new Set(Object.keys(before.hosts ?? {}))
  const newHosts = Object.keys(facts.hosts ?? {}).filter(host => !hostsBefore.has(host))
  const programsBefore = new Set(before.hints?.childProcess ?? [])
  const newPrograms = (facts.hints?.childProcess ?? []).filter(file => !programsBefore.has(file))
  if (newHosts.length > 0 || newPrograms.length > 0) {
    return refuse(plugin.name, latest, `it reaches new hosts (${newHosts.join(', ') || 'none'}) or starts new programs (${newPrograms.join(', ') || 'none'})`)
  }
  const baseline = humanReviewedBaseline(plugin.versions)
  const size = await sizeRule(plugin, latest, facts, baseline, baseline?.version === previous.version ? before : undefined)
  if (size.refusal !== undefined) return refuse(plugin.name, latest, `it ${size.refusal}`)
  const { license, testedOn, capabilities, installScripts } = previous.review
  pending.push({
    plugin, version: latest, facts, document: firstPartyDocument({ plugin, previous, version: latest, facts }),
    entry: {
      version: latest,
      integrity: facts.integrity,
      review: {
        reviewer: AUTOMATED_REVIEWER, date: today, license, testedOn, capabilities, installScripts,
        ...size.sizeException === undefined ? {} : { sizeException: size.sizeException },
        notes: `Automated first-party release ${latest} from ${plugin.name}; capabilities, install scripts and risk notes are unchanged from ${previous.version}.`,
      },
    },
  })
}

async function takeAutoFollow(plugin) {
  const follow = plugin.autoFollow
  const baseline = humanReviewedBaseline(plugin.versions)
  if (baseline === undefined) return refuse(plugin.name, newestListed(plugin).version, 'no listed version was reviewed by hand, so autoFollow has nothing to compare with')
  const packument = await readPackument(plugin)
  if (packument === undefined) return
  const selection = selectRelease({
    packument, listed: plugin.versions.map(entry => entry.version), baseline: baseline.version,
    updates: follow.updates, waitHours: catalog.policy.autoFollowWaitHours, now,
  })
  for (const item of selection.waiting) {
    log(`${plugin.name}@${item.version}: waits until ${item.readyAt} (policy.autoFollowWaitHours)`)
    waiting.push({ name: plugin.name, ...item })
  }
  if (selection.outside.length > 0) {
    refuse(plugin.name, selection.outside[0], `it is outside autoFollow.updates (${follow.updates}) of ${baseline.version}, the version reviewed by hand`)
  }
  const version = selection.candidate
  if (version === undefined) {
    if (selection.waiting.length === 0 && selection.outside.length === 0) log(`${plugin.name}: up to date at ${newestListed(plugin).version}`)
    return
  }
  const facts = await inspect(plugin.name, version, true)
  if (facts === undefined) return
  const notIdentity = identityRefusal({ packument, version, provenance: facts.provenance, autoFollow: follow })
  if (notIdentity !== undefined) return refuse(plugin.name, version, notIdentity)
  const reviewed = await inspect(plugin.name, baseline.version, true)
  if (reviewed === undefined) return
  const changes = behaviorChanges(reviewed, facts)
  if (changes.length > 0) return refuse(plugin.name, version, `compared with ${baseline.version}, the version reviewed by hand: ${changes.join('; ')}`)
  const size = await sizeRule(plugin, version, facts, baseline, reviewed)
  if (size.refusal !== undefined) return refuse(plugin.name, version, `it ${size.refusal}`)
  const publisher = packument.versions?.[version]?._npmUser?.name ?? 'unknown'
  const built = facts.provenance === null ? 'no npm provenance'
    : `npm provenance ${facts.provenance.repository} ${facts.provenance.ref} (${facts.provenance.workflow}${facts.provenance.commit ? `, commit ${facts.provenance.commit.slice(0, 12)}` : ''})`
  const maintainers = (packument.maintainers ?? []).map(person => person.name).join(', ')
  const identity = `- npm 维护者 · Maintainers：${maintainers}\n- 发布账号 · Published by：${publisher}\n- 构建来源 · Provenance：${built}\n- 规则 · Rules：updates ${follow.updates}；npmMaintainers ${follow.npmMaintainers.join(', ')}${follow.npmPublishers ? `；npmPublishers ${follow.npmPublishers.join(', ')}` : ''}${follow.provenance ? `；provenance ${follow.provenance.repository} ${follow.provenance.workflow}` : ''}`
  const { license, testedOn, capabilities, installScripts } = baseline.review
  pending.push({
    plugin, version, facts, document: autoFollowDocument({ plugin, baseline, version, facts, identity }),
    entry: {
      version,
      integrity: facts.integrity,
      review: {
        reviewer: AUTOMATED_REVIEWER, date: today, license, testedOn, capabilities, installScripts,
        ...size.sizeException === undefined ? {} : { sizeException: size.sizeException },
        notes: `Automated third-party release under autoFollow (updates: ${follow.updates}): npm maintainers ${maintainers}; published by ${publisher}; ${built}; published ${facts.published}, at least ${catalog.policy.autoFollowWaitHours} hours before it was listed. Hosts, environment variables, code-hint categories, dependencies and dependency tree stay within ${baseline.version}, reviewed by hand on ${baseline.review.date}; capabilities, install scripts and testedOn are carried over from it. Not trial-installed.`,
      },
    },
  })
}

for (const plugin of catalog.plugins) {
  if (plugin.autoPublish === true) await takeFirstParty(plugin)
  else if (plugin.autoFollow !== undefined) await takeAutoFollow(plugin)
}

// Prove the whole list, including the new versions, before touching the real file. Errors labelled with a new
// version drop that version as refused; any other error means the list itself is broken.
let accepted = [...pending]
const staging = mkdtempSync(join(tmpdir(), 'vd-auto-publish-'))
try {
  while (accepted.length > 0) {
    const draft = {
      ...catalog,
      plugins: catalog.plugins.map(plugin => {
        const addition = accepted.find(entry => entry.plugin.name === plugin.name)
        return addition === undefined ? plugin : { ...plugin, versions: [...plugin.versions, addition.entry] }
      }),
    }
    const draftPath = join(staging, 'plugins.yml')
    writeFileSync(draftPath, stringify(draft, { lineWidth: 0 }))
    const result = await runPipeline(draftPath)
    if (result.errors.length === 0) break
    const label = entry => `${entry.plugin.name}@${entry.version}: `
    const blamed = accepted.filter(entry => result.errors.some(error => error.startsWith(label(entry))))
    if (blamed.length === 0) {
      for (const error of result.errors) console.error(error)
      console.error('the list fails its checks without the new versions; nothing is written')
      accepted = []
      failed = true
      break
    }
    for (const entry of blamed) {
      refuse(entry.plugin.name, entry.version, result.errors.filter(error => error.startsWith(label(entry))).map(error => error.slice(label(entry).length)).join('; '))
    }
    accepted = accepted.filter(entry => !blamed.includes(entry))
  }
} finally {
  rmSync(staging, { recursive: true, force: true })
}

const cell = text => String(text).replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ')
if (values['refusals-output'] !== undefined) {
  const lines = [
    '## 自动收录被拒的版本 · Releases auto-publish refused',
    '',
    `Auto-publish run of ${new Date(now).toISOString().slice(0, 16).replace('T', ' ')} UTC. These releases of plugins marked \`autoPublish\` or \`autoFollow\` did not pass the automatic rules, so none of them is listed. Review one with \`npm run review -- <name>@<version> --dsh <DSH checkout>\`; to list it, add it in a pull request (later releases are then compared with it), or record in CANDIDATES.md why it waits.`,
    '以下版本没有通过自动收录规则，都没有进入索引。审核人用 `npm run review` 审核；决定收录就在 PR 里加入该版本（之后的新版本以它为对比基线），决定暂缓就记在 CANDIDATES.md。',
    '',
    '| 插件 · Plugin | 版本 · Version | 原因 · Reason |',
    '|---|---|---|',
    ...refusals.map(item => `| \`${cell(item.name)}\` | ${cell(item.version)} | ${cell(item.reason)} |`),
    ...waiting.length === 0 ? [] : ['', '等待期中的版本 · Waiting for policy.autoFollowWaitHours：', '', ...waiting.map(item => `- \`${item.name}@${item.version}\`：${item.readyAt}`)],
    '',
  ]
  writeFileSync(values['refusals-output'], lines.join('\n'))
}
if (values['refusals-count-file'] !== undefined) writeFileSync(values['refusals-count-file'], `${refusals.length}\n`)

if (accepted.length === 0) {
  log(refusals.length === 0 && !failed ? 'nothing to publish' : 'nothing to publish this time')
  process.exit(failed ? 1 : 0)
}
if (!values.apply) {
  for (const entry of accepted) log(`would add ${entry.plugin.name}@${entry.version}`)
  log('dry run; pass --apply to write')
  process.exit(failed ? 1 : 0)
}

let text = readFileSync(catalogPath, 'utf8')
for (const entry of accepted) {
  text = appendVersionText(text, entry.plugin.name, entry.entry)
  const file = reviewPath(entry.plugin.name, entry.version)
  mkdirSync(join('reviews', entry.plugin.name.startsWith('@') ? entry.plugin.name.split('/')[0] : '.'), { recursive: true })
  writeFileSync(file, entry.document)
  log(`added ${entry.plugin.name}@${entry.version} and ${file}`)
}
writeFileSync(catalogPath, text)
process.exit(failed ? 1 : 0)
