/**
 * Rules for taking a first-party release into the curated list without a human review (scripts/auto-publish.mjs).
 *
 * A plugin opts in with `autoPublish: true`; the list declares who first party is under `firstParty`. A release is
 * taken only when the npm account that published it and every current npm maintainer are VibeDev's own accounts,
 * and the package's source repository is owned by VibeDev's GitHub organization. A package over the size limit keeps
 * the size exception of the last version a human reviewed, as long as it has not grown beyond SIZE_GROWTH_LIMIT of
 * that version.
 */
import semver from 'semver'
import { repositoryUrl } from './display.mjs'

/** Reviewer recorded on versions the scheduled job added. */
export const AUTOMATED_REVIEWER = 'VibeDev (automated)'

/** Largest size, relative to the last human-reviewed version, that keeps that version's size exception. */
export const SIZE_GROWTH_LIMIT = 1.25

/**
 * The GitHub owner of a package's declared source repository.
 * @param {unknown} repository - `repository` from the package manifest: a string or `{ url }`.
 * @returns {string | undefined} the owner when the repository is on github.com.
 */
export function githubOwner(repository) {
  const declared = typeof repository === 'string' ? repository : typeof repository?.url === 'string' ? repository.url : undefined
  const page = declared === undefined ? undefined : repositoryUrl(declared)
  if (page === undefined) return undefined
  const url = new URL(page)
  return url.hostname === 'github.com' ? url.pathname.split('/')[1] : undefined
}

/**
 * Why a release may not be taken automatically as a first-party release.
 * @param {object} packument - the full registry document of the package.
 * @param {string} version - the release.
 * @param {{ npmPublishers: string[], repositoryOwner: string }} firstParty - `firstParty` from the list.
 * @returns {string | undefined} the reason, or undefined when the release is first party.
 */
export function firstPartyRefusal(packument, version, firstParty) {
  const allowed = new Set(firstParty.npmPublishers)
  const manifest = packument?.versions?.[version]
  if (manifest === undefined) return `npm has no manifest for ${version}`
  const publisher = manifest._npmUser?.name
  if (!allowed.has(publisher)) return `published by ${publisher === undefined ? 'an unknown npm account' : `npm account ${publisher}`}, which is not one of firstParty.npmPublishers`
  const maintainers = (Array.isArray(packument.maintainers) ? packument.maintainers : []).map(person => person?.name)
  if (maintainers.length === 0) return 'npm lists no maintainers for the package'
  const outsiders = maintainers.filter(name => !allowed.has(name))
  if (outsiders.length > 0) return `npm maintainers include ${outsiders.join(', ')}, which are not firstParty.npmPublishers`
  const owner = githubOwner(manifest.repository)
  if (owner?.toLowerCase() !== firstParty.repositoryOwner.toLowerCase()) {
    return `its repository is ${owner === undefined ? 'not on github.com' : `owned by ${owner}`}, not by ${firstParty.repositoryOwner}`
  }
  return undefined
}

/**
 * The newest listed version a human reviewed, whose size exception (if any) an automated release may keep.
 * @param {{ version: string, review: { reviewer: string } }[]} versions - the plugin's listed versions.
 * @returns {object | undefined} the version entry, or undefined when every listed version was added automatically.
 */
export function humanReviewedBaseline(versions) {
  return versions
    .filter(entry => entry.review?.reviewer !== AUTOMATED_REVIEWER)
    .reduce((best, entry) => (best === undefined || semver.gt(entry.version, best.version) ? entry : best), undefined)
}

const mib = bytes => (bytes / 1048576).toFixed(1)

/**
 * The size exception an automated release records, or why it must wait for a human review.
 * @param {{ bytes: number, maxUnpackedBytes: number, baseline: object | undefined, baselineBytes: number | undefined }} input -
 *   the release's unpacked size, the list's limit, the last human-reviewed version and its unpacked size.
 * @returns {{ sizeException?: string, refusal?: string }} nothing when the release is within the limit.
 */
export function automatedSizeException({ bytes, maxUnpackedBytes, baseline, baselineBytes }) {
  if (bytes <= maxUnpackedBytes) return {}
  const reason = baseline?.review?.sizeException
  if (typeof reason !== 'string' || baselineBytes === undefined) {
    return { refusal: `unpacks to ${mib(bytes)} MiB, over the ${mib(maxUnpackedBytes)} MiB limit, and no human-reviewed version carries a size exception` }
  }
  if (bytes > baselineBytes * SIZE_GROWTH_LIMIT) {
    return { refusal: `unpacks to ${mib(bytes)} MiB, more than ${Math.round(SIZE_GROWTH_LIMIT * 100)}% of the ${mib(baselineBytes)} MiB reviewed by hand for ${baseline.version}` }
  }
  return {
    sizeException: `自动收录：解包 ${mib(bytes)} MiB，未超过 ${baseline.version} 人工审核时 ${mib(baselineBytes)} MiB 的 ${Math.round(SIZE_GROWTH_LIMIT * 100)}%，`
      + `沿用其体量说明。Recorded automatically: unpacks to ${mib(bytes)} MiB, within ${Math.round(SIZE_GROWTH_LIMIT * 100)}% of the `
      + `${mib(baselineBytes)} MiB reviewed by hand for ${baseline.version}, whose size reasoning carries over. ${reason}`,
  }
}
