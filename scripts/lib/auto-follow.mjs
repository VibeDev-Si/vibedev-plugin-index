/**
 * Rules for taking a third-party release into the curated list without a human review (scripts/auto-publish.mjs).
 *
 * A plugin opts in with an `autoFollow` block in plugins.yml. A release is taken only when all of these hold:
 * - it is a stable, non-deprecated version newer than every listed version, within `autoFollow.updates` of the last
 *   version a human reviewed (`patch`: same major and minor; `minor`: same major), and it was published at least
 *   `policy.autoFollowWaitHours` hours ago, the time in which npm lets an author unpublish a version;
 * - it comes from the declared identity: every current npm maintainer is in `autoFollow.npmMaintainers`, the
 *   publishing account is in `autoFollow.npmPublishers` when that is declared, and its npm provenance names the
 *   repository and workflow in `autoFollow.provenance` when that is declared;
 * - compared with the last version a human reviewed, it mentions no new host, environment variable, or code-hint
 *   category, adds no dependency and no package to the resolved dependency tree, has no install scripts, and keeps
 *   the license.
 * The highest release that may be taken now is the candidate; newer ones still in their waiting period wait for a
 * later run. Static hints cannot show every new capability, so the user-visible notes of the reviewed version must
 * describe what the plugin may do within these limits.
 */
import semver from 'semver'

/**
 * The release to consider now.
 * @param {{ packument: object, listed: string[], baseline: string, updates: 'patch' | 'minor', waitHours: number,
 *   now: number }} input - the registry document, the listed versions, the last version a human reviewed, the update
 *   range, the waiting period, and the current time in milliseconds.
 * @returns {{ candidate?: string, waiting: { version: string, readyAt: string }[], outside: string[] }} the highest
 *   release that may be taken now, the newer releases still waiting, and the releases outside the update range,
 *   highest first.
 */
export function selectRelease({ packument, listed, baseline, updates, waitHours, now }) {
  const highestListed = listed.filter(version => semver.valid(version) === version).sort(semver.rcompare)[0]
  const base = semver.parse(baseline)
  const waiting = []
  const outside = []
  let candidate
  const versions = Object.keys(packument?.versions ?? {})
    .filter(version => semver.valid(version) === version && semver.prerelease(version) === null)
    .filter(version => highestListed === undefined || semver.gt(version, highestListed))
    .sort(semver.rcompare)
  for (const version of versions) {
    const deprecated = packument.versions[version]?.deprecated
    if (typeof deprecated === 'string' && deprecated !== '') continue
    const parsed = semver.parse(version)
    if (parsed.major !== base.major || (updates === 'patch' && parsed.minor !== base.minor)) {
      outside.push(version)
      continue
    }
    const published = Date.parse(packument.time?.[version] ?? '')
    if (!Number.isFinite(published)) continue
    const readyAt = published + waitHours * 3_600_000
    if (readyAt > now) {
      if (candidate === undefined) waiting.push({ version, readyAt: new Date(readyAt).toISOString() })
      continue
    }
    candidate ??= version
  }
  return { ...candidate === undefined ? {} : { candidate }, waiting, outside }
}

/**
 * Why a release does not come from the identity `autoFollow` declares.
 * @param {{ packument: object, version: string, provenance: { repository?: string, workflow?: string } | null,
 *   autoFollow: { npmMaintainers: string[], npmPublishers?: string[],
 *   provenance?: { repository: string, workflow: string } } }} input - the registry document, the release, its npm
 *   provenance statement, and the plugin's `autoFollow` block.
 * @returns {string | undefined} the reason, or undefined when the release matches.
 */
export function identityRefusal({ packument, version, provenance, autoFollow }) {
  const maintainers = (Array.isArray(packument?.maintainers) ? packument.maintainers : []).map(person => person?.name)
  if (maintainers.length === 0) return 'npm lists no maintainers for the package'
  const outsiders = maintainers.filter(name => !autoFollow.npmMaintainers.includes(name))
  if (outsiders.length > 0) return `npm maintainers include ${outsiders.join(', ')}, which autoFollow.npmMaintainers does not list`
  if (autoFollow.npmPublishers !== undefined) {
    const publisher = packument.versions?.[version]?._npmUser?.name
    if (!autoFollow.npmPublishers.includes(publisher)) {
      return `it was published by ${publisher === undefined ? 'an unknown npm account' : `npm account ${publisher}`}, which autoFollow.npmPublishers does not list`
    }
  }
  if (autoFollow.provenance !== undefined) {
    const expected = autoFollow.provenance
    if (provenance === null || provenance === undefined) return `it has no npm provenance, but autoFollow.provenance requires a build by ${expected.repository} ${expected.workflow}`
    if (String(provenance.repository).toLowerCase() !== expected.repository.toLowerCase() || provenance.workflow !== expected.workflow) {
      return `it was built by ${provenance.repository} ${provenance.workflow}, not by ${expected.repository} ${expected.workflow}`
    }
  }
  return undefined
}

/** The code-hint categories with at least one matching file. */
function hintCategories(facts) {
  return Object.entries(facts.hints ?? {}).filter(([, files]) => files.length > 0).map(([category]) => category)
}

/**
 * What a release does that the version a human reviewed did not, by its static facts.
 * @param {object} reviewed - inspection facts of the last version a human reviewed, with its dependency tree.
 * @param {object} facts - inspection facts of the release, with its dependency tree.
 * @returns {string[]} one entry per change; empty when the release stays within the reviewed version.
 */
export function behaviorChanges(reviewed, facts) {
  const added = (now, before) => now.filter(item => !before.includes(item))
  const dependencyNames = item => Object.keys({ ...item.dependencies, ...item.optionalDependencies })
  const treeNames = item => [...new Set((item.dependencyTree?.packages ?? []).map(entry => entry.name))]
  const tree = facts.dependencyTree ?? {}
  return [
    ['new hosts in code', added(Object.keys(facts.hosts ?? {}), Object.keys(reviewed.hosts ?? {}))],
    ['new environment variables', added(Object.keys(facts.envVars ?? {}), Object.keys(reviewed.envVars ?? {}))],
    ['new code-hint categories', added(hintCategories(facts), hintCategories(reviewed))],
    ['new dependencies', added(dependencyNames(facts), dependencyNames(reviewed))],
    ['new packages in the dependency tree', added(treeNames(facts), treeNames(reviewed))],
    ['install scripts', facts.installScripts ?? []],
    ['install scripts in the dependency tree', tree.withInstallScripts ?? []],
    ['dependency licenses outside the accepted list', tree.licensesOutsideList ?? []],
    ['unresolved dependencies', [...tree.unresolved ?? [], ...tree.truncated ? ['the tree has more than 300 packages'] : []]],
    ['license changed', facts.license === reviewed.license ? [] : [`${reviewed.license} to ${facts.license}`]],
    ['deprecated on npm', facts.deprecated ? [facts.deprecated] : []],
  ].filter(([, items]) => items.length > 0).map(([label, items]) => `${label}: ${items.join(', ')}`)
}
