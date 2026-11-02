// Rules behind third-party autoFollow (scripts/lib/auto-follow.mjs) and its plugins.yml declaration.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { behaviorChanges, identityRefusal, selectRelease } from '../scripts/lib/auto-follow.mjs'
import { checkCatalog } from '../scripts/lib/catalog.mjs'

const HOUR = 3_600_000
const NOW = Date.parse('2026-11-10T00:00:00Z')
const ago = hours => new Date(NOW - hours * HOUR).toISOString()

/** A registry document with the given versions: { version: [hours ago, extra manifest fields] }. */
function packument(versions, maintainers = ['alice']) {
  return {
    maintainers: maintainers.map(name => ({ name })),
    versions: Object.fromEntries(Object.entries(versions).map(([version, [, extra = {}]]) => [version, { _npmUser: { name: 'alice' }, ...extra }])),
    time: Object.fromEntries(Object.entries(versions).map(([version, [hours]]) => [version, ago(hours)])),
  }
}

test('selectRelease takes the highest release past the waiting period within the update range', () => {
  const document = packument({ '1.2.0': [500], '1.2.1': [200], '1.2.2': [100], '1.2.3': [10], '1.3.0': [300], '2.0.0': [400] })
  const base = { packument: document, listed: ['1.2.0'], baseline: '1.2.0', waitHours: 72, now: NOW }
  const patch = selectRelease({ ...base, updates: 'patch' })
  assert.equal(patch.candidate, '1.2.2')
  assert.deepEqual(patch.waiting.map(item => item.version), ['1.2.3'])
  assert.equal(patch.waiting[0].readyAt, new Date(NOW - 10 * HOUR + 72 * HOUR).toISOString())
  assert.deepEqual(patch.outside, ['2.0.0', '1.3.0'])
  const minor = selectRelease({ ...base, updates: 'minor' })
  assert.equal(minor.candidate, '1.3.0')
  assert.deepEqual(minor.outside, ['2.0.0'])
})

test('selectRelease skips prereleases, deprecated releases and versions not above the listed ones', () => {
  const document = packument({ '1.0.0': [500], '1.0.1': [400, { deprecated: 'broken' }], '1.0.2-rc.1': [300], '0.9.9': [200] })
  const result = selectRelease({ packument: document, listed: ['1.0.0'], baseline: '1.0.0', updates: 'minor', waitHours: 72, now: NOW })
  assert.deepEqual(result, { waiting: [], outside: [] })
})

test('selectRelease compares the update range with the version reviewed by hand, not the newest listed one', () => {
  const document = packument({ '0.4.1': [500], '0.4.2': [400], '0.4.3': [300] })
  const result = selectRelease({ packument: document, listed: ['0.4.1', '0.4.2'], baseline: '0.4.1', updates: 'patch', waitHours: 72, now: NOW })
  assert.equal(result.candidate, '0.4.3')
})

test('identityRefusal requires the declared maintainers, publishers and provenance', () => {
  const document = packument({ '1.1.0': [100] })
  const provenance = { repository: 'https://github.com/alice/plugin', workflow: '.github/workflows/release.yml', ref: 'refs/tags/v1.1.0' }
  const byPublisher = { npmMaintainers: ['alice'], npmPublishers: ['alice'] }
  const byProvenance = { npmMaintainers: ['alice'], provenance: { repository: 'https://github.com/Alice/plugin', workflow: '.github/workflows/release.yml' } }
  assert.equal(identityRefusal({ packument: document, version: '1.1.0', provenance: null, autoFollow: byPublisher }), undefined)
  assert.equal(identityRefusal({ packument: document, version: '1.1.0', provenance, autoFollow: byProvenance }), undefined)
  assert.match(identityRefusal({ packument: packument({ '1.1.0': [100] }, ['alice', 'mallory']), version: '1.1.0', provenance, autoFollow: byProvenance }), /maintainers include mallory/u)
  assert.match(identityRefusal({ packument: packument({ '1.1.0': [100] }, []), version: '1.1.0', provenance, autoFollow: byProvenance }), /no maintainers/u)
  const otherPublisher = packument({ '1.1.0': [100, { _npmUser: { name: 'mallory' } }] })
  assert.match(identityRefusal({ packument: otherPublisher, version: '1.1.0', provenance: null, autoFollow: byPublisher }), /npm account mallory/u)
  assert.match(identityRefusal({ packument: document, version: '1.1.0', provenance: null, autoFollow: byProvenance }), /no npm provenance/u)
  assert.match(identityRefusal({ packument: document, version: '1.1.0', provenance: { ...provenance, workflow: '.github/workflows/other.yml' }, autoFollow: byProvenance }), /built by/u)
  assert.match(identityRefusal({ packument: document, version: '1.1.0', provenance: { ...provenance, repository: 'https://github.com/mallory/plugin' }, autoFollow: byProvenance }), /mallory\/plugin/u)
})

const facts = (extra = {}) => ({
  hosts: { 'api.example.com': ['lib/index.js'] },
  envVars: { HOME_DIR: ['lib/index.js'] },
  hints: { network: ['lib/index.js'], credentials: [], childProcess: [] },
  dependencies: { zod: '^4.0.0' },
  optionalDependencies: {},
  dependencyTree: { packages: [{ name: 'zod', version: '4.0.0' }], withInstallScripts: [], licensesOutsideList: [], unresolved: [], truncated: false },
  installScripts: [],
  license: 'MIT',
  deprecated: null,
  ...extra,
})

test('behaviorChanges accepts a release that stays within the reviewed version', () => {
  const later = facts({ hosts: {}, hints: { network: ['lib/client.js'], credentials: [] }, dependencies: { zod: '^4.6.0' } })
  assert.deepEqual(behaviorChanges(facts(), later), [])
})

test('behaviorChanges reports every kind of addition', () => {
  const later = facts({
    hosts: { 'api.example.com': ['a'], 'evil.example.net': ['b'] },
    envVars: { HOME_DIR: ['a'], NPM_TOKEN: ['a'] },
    hints: { network: ['a'], credentials: ['a'], childProcess: [] },
    dependencies: { zod: '^4.0.0', axios: '^1.0.0' },
    dependencyTree: { packages: [{ name: 'zod' }, { name: 'axios' }, { name: 'follow-redirects' }], withInstallScripts: ['axios@1.0.0'], licensesOutsideList: [], unresolved: [], truncated: true },
    installScripts: ['postinstall'],
    license: 'GPL-3.0-only',
    deprecated: 'use 2.x',
  })
  const changes = behaviorChanges(facts(), later).join('\n')
  for (const expected of ['new hosts in code: evil.example.net', 'new environment variables: NPM_TOKEN', 'new code-hint categories: credentials',
    'new dependencies: axios', 'new packages in the dependency tree: axios, follow-redirects', 'install scripts: postinstall',
    'install scripts in the dependency tree: axios@1.0.0', 'unresolved dependencies: the tree has more than 300 packages',
    'license changed: MIT to GPL-3.0-only', 'deprecated on npm: use 2.x']) {
    assert.ok(changes.includes(expected), expected)
  }
})

const review = { reviewer: 'VibeDev', date: '2026-10-29', license: 'MIT', testedOn: ['0.2.1-rc.2'], capabilities: { network: [], files: 'none', config: 'none', childProcess: [] }, installScripts: [], notes: 'Reviewed.' }
const catalog = (plugins, policy = {}) => ({
  schema: 1, index: { title: { en: 'T' } }, target: { dsh: '0.2.1-rc.2' },
  policy: { maxUnpackedBytes: 1, inlineIconBytes: 0, autoFollowWaitHours: 72, ...policy }, categories: { tools: { en: 'Tools' } }, plugins,
})
const plugin = autoFollow => ({ name: 'p', category: 'tools', tags: [], maintainer: 'm@x.io', autoFollow, versions: [{ version: '1.0.0', integrity: `sha512-${'A'.repeat(86)}==`, review }] })

test('checkCatalog accepts autoFollow by publisher or by provenance', () => {
  assert.deepEqual(checkCatalog(catalog([plugin({ updates: 'patch', npmMaintainers: ['alice'], npmPublishers: ['alice'] })])).errors, [])
  const byProvenance = { updates: 'minor', npmMaintainers: ['alice'], provenance: { repository: 'https://github.com/alice/p', workflow: '.github/workflows/release.yml' } }
  assert.deepEqual(checkCatalog(catalog([plugin(byProvenance)])).errors, [])
})

test('checkCatalog rejects incomplete or conflicting autoFollow declarations', () => {
  const valid = { updates: 'patch', npmMaintainers: ['alice'], npmPublishers: ['alice'] }
  for (const [list, message] of [
    [catalog([plugin(valid)], { autoFollowWaitHours: undefined }), 'requires $.policy.autoFollowWaitHours'],
    [catalog([plugin(valid)], { autoFollowWaitHours: 0 }), 'whole number of hours'],
    [catalog([{ ...plugin(valid), autoPublish: true }]), 'cannot be combined with autoPublish'],
    [catalog([plugin({ ...valid, updates: 'major' })]), 'must be patch'],
    [catalog([plugin({ updates: 'patch', npmMaintainers: ['alice'] })]), 'needs npmPublishers or provenance'],
    [catalog([plugin({ ...valid, npmMaintainers: [] })]), 'at least one npm account'],
    [catalog([plugin({ ...valid, provenance: { repository: 'https://gitlab.com/a/p', workflow: '.github/workflows/r.yml' } })]), 'https://github.com/<owner>/<repository>'],
    [catalog([plugin({ ...valid, provenance: { repository: 'https://github.com/a/p', workflow: 'release.yml' } })]), 'workflow path'],
  ]) {
    if (list.policy.autoFollowWaitHours === undefined) delete list.policy.autoFollowWaitHours
    assert.ok(checkCatalog(list).errors.some(error => error.includes(message)), message)
  }
})
