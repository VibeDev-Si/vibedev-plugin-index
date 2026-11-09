// Rules and edits behind scripts/auto-publish.mjs: who first party is, size exceptions, and text-preserving appends.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parse } from 'yaml'
import { checkCatalog } from '../scripts/lib/catalog.mjs'
import { appendVersionText, renderVersionItem } from '../scripts/lib/catalog-edit.mjs'
import {
  AUTOMATED_REVIEWER, SIZE_GROWTH_LIMIT, automatedSizeException, firstPartyRefusal, githubOwner, humanReviewedBaseline,
} from '../scripts/lib/first-party.mjs'

const integrity = `sha512-${'A'.repeat(86)}==`
const review = (extra = {}) => ({
  reviewer: 'VibeDev', date: '2026-10-29', license: 'MIT', testedOn: ['0.2.1-rc.2'],
  capabilities: { network: [], files: 'none', config: 'none', childProcess: [] }, installScripts: [], notes: 'Reviewed.', ...extra,
})
const catalog = (plugins, extra = {}) => ({
  schema: 1, index: { title: { en: 'T' } }, target: { dsh: '0.2.1-rc.2' },
  policy: { maxUnpackedBytes: 1, inlineIconBytes: 0 }, categories: { tools: { en: 'Tools' } }, plugins, ...extra,
})
const plugin = (name, extra = {}) => ({ name, category: 'tools', tags: [], maintainer: 'https://github.com/a/b/issues', versions: [{ version: '1.0.0', integrity, review: review() }], ...extra })
const firstParty = { npmPublishers: ['crider'], repositoryOwner: 'VibeDev-Si' }

test('autoPublish requires a firstParty declaration, scoped or not', () => {
  assert.ok(checkCatalog(catalog([plugin('@vibedev-si/x', { autoPublish: true })])).errors.some(error => error.includes('requires $.firstParty')))
  assert.deepEqual(checkCatalog(catalog([plugin('@vibedev-si/x', { autoPublish: true }), plugin('dsh-film', { autoPublish: true })], { firstParty })).errors, [])
  assert.deepEqual(checkCatalog(catalog([plugin('third-party')], { firstParty })).errors, [])
})

test('checkCatalog rejects a malformed firstParty declaration', () => {
  for (const [value, message] of [
    [{ npmPublishers: [], repositoryOwner: 'VibeDev-Si' }, 'at least one npm account'],
    [{ npmPublishers: ['Crider Upper'], repositoryOwner: 'VibeDev-Si' }, 'npm account names'],
    [{ npmPublishers: ['crider'], repositoryOwner: 'not/an-owner' }, 'GitHub user or organization'],
    [{ npmPublishers: ['crider'] }, 'repositoryOwner: is required'],
    [{ npmPublishers: ['crider'], repositoryOwner: 'VibeDev-Si', extra: 1 }, 'extra'],
  ]) {
    assert.ok(checkCatalog(catalog([], { firstParty: value })).errors.some(error => error.includes(message)), message)
  }
})

test('githubOwner reads string, object and shorthand repositories on github.com only', () => {
  assert.equal(githubOwner('git+https://github.com/VibeDev-Si/dsh-film.git'), 'VibeDev-Si')
  assert.equal(githubOwner({ type: 'git', url: 'https://github.com/VibeDev-Si/dsh-remote' }), 'VibeDev-Si')
  assert.equal(githubOwner('VibeDev-Si/dsh-remote'), 'VibeDev-Si')
  assert.equal(githubOwner('https://gitlab.com/VibeDev-Si/dsh-remote'), undefined)
  assert.equal(githubOwner(undefined), undefined)
})

test('firstPartyRefusal takes only releases published and maintained by firstParty from its organization', () => {
  const packument = (overrides = {}) => ({
    maintainers: [{ name: 'crider' }],
    versions: { '1.1.0': { _npmUser: { name: 'crider' }, repository: { url: 'git+https://github.com/VibeDev-Si/dsh-film.git' } } },
    ...overrides,
  })
  assert.equal(firstPartyRefusal(packument(), '1.1.0', firstParty), undefined)
  assert.match(firstPartyRefusal(packument(), '9.9.9', firstParty), /no manifest/u)
  const otherPublisher = packument({ versions: { '1.1.0': { _npmUser: { name: 'mallory' }, repository: 'VibeDev-Si/dsh-film' } } })
  assert.match(firstPartyRefusal(otherPublisher, '1.1.0', firstParty), /npm account mallory/u)
  assert.match(firstPartyRefusal(packument({ maintainers: [{ name: 'crider' }, { name: 'mallory' }] }), '1.1.0', firstParty), /maintainers include mallory/u)
  assert.match(firstPartyRefusal(packument({ maintainers: [] }), '1.1.0', firstParty), /no maintainers/u)
  const otherOwner = packument({ versions: { '1.1.0': { _npmUser: { name: 'crider' }, repository: 'https://github.com/someone/dsh-film' } } })
  assert.match(firstPartyRefusal(otherOwner, '1.1.0', firstParty), /owned by someone/u)
})

test('firstPartyRefusal takes a GitHub trusted-publishing release only from first-party maintainers and organization', () => {
  // What npm records for an OIDC release (dsh-film@0.9.1): no first-party account published it.
  const oidc = { name: 'GitHub Actions', email: 'npm-oidc-no-reply@github.com', trustedPublisher: { id: 'github', oidcConfigId: 'c6d0bc6c' } }
  const release = (user, repository = 'git+https://github.com/VibeDev-Si/dsh-film.git', maintainers = [{ name: 'crider' }]) => ({
    maintainers, versions: { '0.9.1': { _npmUser: user, repository } },
  })
  assert.equal(firstPartyRefusal(release(oidc), '0.9.1', firstParty), undefined)
  // The display name alone is not npm's trusted-publishing record.
  assert.match(firstPartyRefusal(release({ name: 'GitHub Actions' }), '0.9.1', firstParty), /neither one of firstParty.npmPublishers nor a GitHub trusted publisher/u)
  assert.match(firstPartyRefusal(release({ ...oidc, trustedPublisher: { id: 'gitlab' } }), '0.9.1', firstParty), /npm account GitHub Actions/u)
  // Trusted publishing is configured by maintainers, so it vouches only when every maintainer is first party.
  assert.match(firstPartyRefusal(release(oidc, undefined, [{ name: 'crider' }, { name: 'mallory' }]), '0.9.1', firstParty), /maintainers include mallory/u)
  assert.match(firstPartyRefusal(release(oidc, 'https://github.com/someone/dsh-film'), '0.9.1', firstParty), /owned by someone/u)
})

test('humanReviewedBaseline is the newest version a person reviewed', () => {
  const versions = [
    { version: '0.8.0', review: { reviewer: 'VibeDev' } },
    { version: '0.9.0', review: { reviewer: AUTOMATED_REVIEWER } },
    { version: '0.7.0', review: { reviewer: 'VibeDev' } },
  ]
  assert.equal(humanReviewedBaseline(versions).version, '0.8.0')
  assert.equal(humanReviewedBaseline([{ version: '1.0.0', review: { reviewer: AUTOMATED_REVIEWER } }]), undefined)
})

test('automatedSizeException keeps a reviewed exception only within the growth limit', () => {
  const max = 20 * 1048576
  const baseline = { version: '0.8.0', review: { sizeException: 'Ships Bun runtimes.' } }
  assert.deepEqual(automatedSizeException({ bytes: max, maxUnpackedBytes: max, baseline, baselineBytes: undefined }), {})
  const carried = automatedSizeException({ bytes: 50 * 1048576, maxUnpackedBytes: max, baseline, baselineBytes: 45 * 1048576 })
  assert.equal(carried.refusal, undefined)
  assert.match(carried.sizeException, /0\.8\.0/u)
  assert.ok(carried.sizeException.endsWith('Ships Bun runtimes.'))
  const grown = automatedSizeException({ bytes: Math.ceil(45 * 1048576 * SIZE_GROWTH_LIMIT) + 1, maxUnpackedBytes: max, baseline, baselineBytes: 45 * 1048576 })
  assert.match(grown.refusal, /reviewed by hand for 0\.8\.0/u)
  const noException = automatedSizeException({ bytes: max + 1, maxUnpackedBytes: max, baseline: { version: '1.0.0', review: {} }, baselineBytes: max })
  assert.match(noException.refusal, /no human-reviewed version carries a size exception/u)
})

const SOURCE = `# Header comment stays.
schema: 1
plugins:
  - name: "@vibedev-si/a"
    tags: [vibedev]
    versions:
      - version: 1.0.0
        integrity: sha512-old
        review:
          testedOn: [0.2.1-rc.2]
          notes: >-
            A folded note that a full re-serialization would
            rewrap.
  # A comment between plugins stays.
  - name: b
    versions:
      - version: 2.0.0
        integrity: sha512-b
`

/** The lines inserted into `before` to make `after`, when `after` is `before` plus one contiguous block. */
function insertedBlock(before, after) {
  const old = before.split('\n'), now = after.split('\n')
  let start = 0
  while (start < old.length && old[start] === now[start]) start++
  const size = now.length - old.length
  assert.deepEqual([...now.slice(0, start), ...now.slice(start + size)], old, 'the rest of the file changed')
  return { start, lines: now.slice(start, start + size), following: now[start + size] }
}

test('appendVersionText adds only the new entry and keeps every other byte', () => {
  const entry = { version: '1.1.0', integrity: 'sha512-new', review: { reviewer: AUTOMATED_REVIEWER, testedOn: ['0.2.1-rc.2'], capabilities: { network: ['*'] }, installScripts: [], notes: 'colon: and #hash' } }
  const result = appendVersionText(SOURCE, '@vibedev-si/a', entry)
  const block = insertedBlock(SOURCE, result)
  assert.equal(block.lines[0], '      - version: 1.1.0')
  assert.equal(block.following, '  # A comment between plugins stays.')
  assert.ok(block.lines.includes('          testedOn: [0.2.1-rc.2]'))
  assert.ok(block.lines.includes('            network: ["*"]'))
  assert.deepEqual(parse(result).plugins[0].versions[1], entry)
  const last = appendVersionText(SOURCE, 'b', { ...entry, version: '2.1.0' })
  const end = insertedBlock(SOURCE, last)
  assert.equal(end.lines[0], '      - version: 2.1.0')
  assert.equal(end.following, '')
  assert.equal(parse(last).plugins[1].versions[1].version, '2.1.0')
})

test('appendVersionText refuses a missing plugin and a flow-style versions list', () => {
  assert.throws(() => appendVersionText(SOURCE, 'missing', { version: '1.0.0' }), /not in plugins\.yml/u)
  assert.throws(() => appendVersionText('plugins:\n  - name: c\n    versions: [{ version: 1.0.0 }]\n', 'c', { version: '1.1.0' }), /block list/u)
})

test('renderVersionItem writes scalar lists in flow style on one line', () => {
  assert.equal(renderVersionItem({ version: '1.0.0', review: { testedOn: ['0.2.1-rc.2'], notes: 'x'.repeat(200) } }),
    `- version: 1.0.0\n  review:\n    testedOn: [0.2.1-rc.2]\n    notes: ${'x'.repeat(200)}\n`)
})
