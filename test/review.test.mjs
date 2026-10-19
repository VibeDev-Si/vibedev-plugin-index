/** Offline tests of review records: trial summaries, version comparison, the YAML draft, and the TODO rule. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parse as parseYaml } from 'yaml'
import { checkCatalog } from '../scripts/lib/catalog.mjs'
import { HINTS } from '../scripts/lib/inspection.mjs'
import { compareFacts, diffFiles, draftEntry, renderRecord, summarizeTrial, yamlScalar } from '../scripts/lib/review-record.mjs'
import { PackageFiles } from '../scripts/lib/package-files.mjs'

const hints = (overrides = {}) => ({ ...Object.fromEntries(Object.keys(HINTS).map(key => [key, []])), ...overrides })
const fakeReport = (overrides = {}) => ({
  name: 'dsh-example', version: '1.1.0', target: '0.2.1-rc.2', published: '2026-10-18T10:00:00.000Z', distTags: { latest: '1.1.0' },
  versionsPublished: 3, versionsLast30Days: 2, deprecated: null, integrity: `sha512-${'A'.repeat(86)}==`,
  license: 'MIT', licenseAccepted: true, licenseFiles: ['LICENSE'], provenance: null, bundle: true,
  enginesDsh: '>=0.2.0-rc.2 <0.3.0', dshPeers: {}, otherPeers: {}, indexEnginesDsh: '>=0.2.0-rc.2 <0.3.0', declaresDsh: true,
  compatibleInDiscover: true, compatibleAtInstall: true, unmet: {}, installScripts: [], npmHasInstallScript: false,
  unpackedBytes: 100_000, fileCount: 4, tarballBytes: 30_000, dependencies: {}, optionalDependencies: {},
  description: 'Shows context usage', keywords: ['usage'], repository: 'https://github.com/example/dsh-example', homepage: null,
  bugs: null, maintainers: ['example'], hints: hints(), hosts: {}, envVars: {},
  dependencyTree: { count: 0, truncated: false, packages: [], withInstallScripts: [], licensesOutsideList: [], unresolved: [] },
  ...overrides,
})

const rawTrial = {
  root: 'C:\\Temp\\vibedev-install-trial-abc', dshVersion: '0.2.1-rc.2',
  installs: [{ spec: 'dsh-example@1.1.0', application: 'applied', version: '1.1.0' }],
  states: { 'boot1:dsh-example': { rows: [{ row: 'example', state: 'ACTIVE' }] }, 'boot2:dsh-example': { rows: [{ row: 'example', state: 'ACTIVE' }] } },
  spawns: [
    { phase: 'boot1', file: 'git', args: ['status'] },
    { phase: 'install:dsh-example@1.1.0', file: 'C:\\node\\node.exe', args: ['C:\\pnpm\\bin\\pnpm.mjs', 'add', 'dsh-example@1.1.0'] },
    { phase: 'install:dsh-example@1.1.0', file: 'bsk', args: ['--version', '--json'] },
    { phase: 'boot2', file: 'bsk', args: ['--version', '--json'] },
  ],
  connections: [
    { phase: 'install:dsh-example@1.1.0', kind: 'connect', target: 'registry.npmjs.org:443', allowed: true },
    { phase: 'call:POST /api/example', kind: 'connect', target: 'api.example.com:443', allowed: false },
  ],
  fetches: [{ phase: 'call:POST /api/example', via: 'fetch', method: 'GET', url: 'https://api.example.com/user', authorization: true }],
  credentials: [{ phase: 'call:POST /api/example', name: 'EXAMPLE_KEY' }],
  tools: [{ phase: 'install:dsh-example@1.1.0', name: 'example_tool' }], skills: [], webRoutes: [{ phase: 'install:dsh-example@1.1.0', path: '/example/state' }],
  connectionRoutes: [{ path: '/api/example', methods: ['POST'] }],
  calls: [{ method: 'POST', path: '/api/example', kind: 'connection', status: 200, body: '{}', credentialReads: ['EXAMPLE_KEY'], fetches: ['GET https://api.example.com/user (Authorization)'], spawns: [], connections: ['api.example.com:443 (refused)'] }],
}

test('summarizeTrial keeps plugin activity and drops the baseline and DSH installation runs', () => {
  const trial = summarizeTrial(rawTrial, { names: ['dsh-example'] })
  assert.equal(trial.ok, true)
  assert.deepEqual(trial.processes, ['install: bsk --version --json', 'restart: bsk --version --json'])
  assert.deepEqual(trial.programs, ['bsk'])
  assert.deepEqual(trial.installTraffic, ['registry.npmjs.org:443'])
  assert.deepEqual(trial.connections, ['POST /api/example: api.example.com:443 (refused)'])
  assert.deepEqual(trial.fetches, ['POST /api/example: GET https://api.example.com/user (Authorization)'])
  assert.deepEqual(trial.credentialReads, ['POST /api/example: EXAMPLE_KEY'])
  assert.deepEqual(trial.registrations, { tools: ['example_tool'], skills: [], webRoutes: ['/example/state'], connectionRoutes: ['POST /api/example'] })
  const failed = summarizeTrial({ ...rawTrial, states: { ...rawTrial.states, 'boot2:dsh-example': { rows: [{ row: 'example', state: 'FAILED' }] } } }, { names: ['dsh-example'] })
  assert.equal(failed.ok, false)
})

test('compareFacts flags dependency and capability changes but not renamed bundler chunks', () => {
  const before = { report: fakeReport({ version: '1.0.0', hints: hints({ childProcess: ['lib/host-BPf6iOPo.js'] }) }), trial: summarizeTrial(rawTrial, { names: ['dsh-example'] }) }
  const after = {
    report: fakeReport({ dependencies: { zod: '^4.0.0' }, hosts: { 'api.example.com': ['lib/index.js'] }, hints: hints({ childProcess: ['lib/host-Xy12abCD.js'] }) }),
    trial: summarizeTrial({ ...rawTrial, tools: [...rawTrial.tools, { phase: 'install:x', name: 'second_tool' }] }, { names: ['dsh-example'] }),
  }
  const delta = compareFacts(before, after)
  assert.ok(delta.highlights.some(label => label.includes('Dependencies')))
  assert.ok(delta.highlights.some(label => label.includes('Hosts in code')))
  assert.ok(delta.highlights.some(label => label.includes('registrations')))
  assert.ok(!delta.highlights.some(label => label.includes('Child processes')), 'a renamed chunk is not a new child process')
  const files = diffFiles(new PackageFiles(new Map([['a.js', Buffer.from('1')], ['b.js', Buffer.from('2')]])), new PackageFiles(new Map([['a.js', Buffer.from('1!')], ['c.js', Buffer.from('3')]])))
  assert.deepEqual([files.added.map(item => item.path), files.removed.map(item => item.path), files.changed.map(item => item.path), files.unchanged], [['c.js'], ['b.js'], ['a.js'], 0])
})

test('yamlScalar quotes only what YAML would misread', () => {
  for (const plain of ['dsh-context', '0.73.2', '2026-10-19', 'https://github.com/a/b/issues', 'a@b.io', `sha512-${'A'.repeat(86)}==`]) assert.equal(yamlScalar(plain), plain)
  for (const quoted of ['@scope/name', '*', 'true', '1.5', 'a: b', 'x:', '']) assert.equal(yamlScalar(quoted), JSON.stringify(quoted))
})

const categories = { tools: { en: 'Tools' }, usage: { en: 'Usage' } }
const catalogWith = plugins => ({ schema: 1, index: { title: 'T' }, target: { dsh: '0.2.1-rc.2' }, policy: { maxUnpackedBytes: 20971520, inlineIconBytes: 16384 }, categories, plugins })

test('a new-plugin draft parses, carries the facts, and fails validation only on its TODOs', () => {
  const trial = summarizeTrial(rawTrial, { names: ['dsh-example'] })
  const draft = draftEntry({ report: fakeReport({ hosts: { 'api.example.com': ['lib/index.js'] } }), trial, listing: {}, categories, today: '2026-10-19' })
  assert.equal(draft.kind, 'new')
  const [entry] = parseYaml(`plugins:\n${draft.yaml}\n`).plugins
  assert.equal(entry.category, 'usage')
  assert.equal(entry.maintainer, 'https://github.com/example/dsh-example/issues')
  const { review } = entry.versions[0]
  assert.deepEqual(review.testedOn, ['0.2.1-rc.2'])
  assert.deepEqual(review.capabilities, { network: ['api.example.com'], files: 'none', config: 'none', childProcess: ['bsk'] })
  assert.match(review.notes, /Trial on DSH 0\.2\.1-rc\.2/u)
  const errors = checkCatalog(catalogWith([entry])).errors
  assert.ok(errors.length > 0 && errors.every(error => error.includes('TODO')), errors.join('\n'))
  entry.display.description = { en: 'Shows context usage.', zh: '显示上下文用量。' }
  assert.deepEqual(checkCatalog(catalogWith([entry])).errors, [])
})

test('an update draft is one versions item; a failed trial leaves testedOn empty', () => {
  const listed = { name: 'dsh-example', category: 'usage', tags: [], maintainer: 'm@x.io', versions: [] }
  const draft = draftEntry({ report: fakeReport(), trial: { skipped: 'no DSH checkout' }, listing: { plugin: listed }, categories, today: '2026-10-19', previous: '1.0.0' })
  assert.equal(draft.kind, 'update')
  const [item] = parseYaml(draft.yaml.split('\n').map(line => line.slice(6)).join('\n'))
  assert.equal(item.version, '1.1.0')
  assert.deepEqual(item.review.testedOn, [])
  assert.match(item.review.notes, /No install trial/u)
})

test('an update draft carries the reviewed capabilities forward and adds only new hosts', () => {
  const reviewed = { reviewer: 'VibeDev', date: '2026-10-01', license: 'MIT', testedOn: ['0.2.1-rc.2'], installScripts: [], notes: 'n',
    capabilities: { network: ['api.example.com'], files: 'write', config: 'read', childProcess: [] } }
  const listed = { name: 'dsh-example', category: 'usage', tags: [], maintainer: 'm@x.io', versions: [{ version: '1.0.0', integrity: `sha512-${'B'.repeat(86)}==`, review: reviewed }] }
  const previousReport = fakeReport({ version: '1.0.0', hosts: { 'api.example.com': ['lib/index.js'], 'docs.example.dev': ['lib/client.js'] } })
  const report = fakeReport({ hosts: { 'api.example.com': ['lib/index.js'], 'docs.example.dev': ['lib/client.js'], 'new.example.net': ['lib/index.js'] } })
  const draft = draftEntry({ report, trial: summarizeTrial(rawTrial, { names: ['dsh-example'] }), listing: { plugin: listed }, categories, today: '2026-10-19', previous: '1.0.0', previousReport })
  const [item] = parseYaml(draft.yaml.split('\n').map(line => line.slice(6)).join('\n'))
  assert.deepEqual(item.review.capabilities, { network: ['api.example.com', 'new.example.net'], files: 'write', config: 'read', childProcess: ['bsk'] })
  assert.match(draft.yaml, /carried over from 1\.0\.0; new: new\.example\.net/u)
})

test('summarizeTrial reports listeners, build approvals, the extra start, files, and the profile patch', () => {
  const raw = {
    ...rawTrial,
    extraStart: { env: { DO_NOT_TRACK: '1' }, reset: ['telemetry/dsh-example'] },
    states: { ...rawTrial.states, 'boot3:dsh-example': { rows: [{ row: 'example', state: 'ACTIVE' }] } },
    installs: [{
      spec: 'dsh-example@1.1.0', application: 'applied', version: '1.1.0',
      attempts: [{ application: 'failed', pendingBuilds: ['native@1.0.0'] }, { application: 'applied', approvedBuilds: ['native@1.0.0'] }],
    }],
    connections: [...rawTrial.connections, { phase: 'idle3', kind: 'connect', target: 'telemetry.example.com:443', allowed: false }],
    network: {
      supported: true, samples: 4,
      listeners: [
        { proto: 'TCP', address: '127.0.0.1', port: 5000, pid: 1, process: 'trial process (DSH)', role: 'dsh-web', firstPhase: 'boot1' },
        { proto: 'TCP', address: '127.0.0.1', port: 6000, pid: 3, process: 'other', firstPhase: 'boot1' },
        { proto: 'TCP', address: '127.0.0.1', port: 9080, pid: 2, process: 'node.exe', firstPhase: 'call:invoke svc.start' },
        { proto: 'TCP', address: '0.0.0.0', port: 7000, pid: 2, process: 'node.exe', firstPhase: 'idle2' },
      ],
      remote: [{ pid: 2, process: 'node.exe', remote: '203.0.113.5', port: 443, firstPhase: 'idle2' }],
      processes: [
        { pid: 2, name: 'node.exe', cmd: 'C:\\node.exe C:\\Temp\\vibedev-install-trial-abc\\gateway.cjs', firstPhase: 'call:invoke svc.start' },
        { pid: 5, name: 'conhost.exe', cmd: 'conhost.exe 0x4', firstPhase: 'install:dsh-example@1.1.0' },
      ],
    },
    files: [
      { checkpoint: 'baseline', added: ['home/a (1 B)'], changed: [], removed: [], counts: { added: 1, changed: 0, removed: 0 } },
      { checkpoint: 'install', added: ['home/telemetry/state.json (10 B)'], changed: [], removed: [], counts: { added: 1, changed: 0, removed: 0 } },
    ],
    patches: [{ checkpoint: 'baseline', exists: true, sha256: 'a', rows: [] }, { checkpoint: 'install', exists: true, sha256: 'b', rows: ['webserver'] }],
  }
  const trial = summarizeTrial(raw, { names: ['dsh-example'] })
  assert.equal(trial.ok, true)
  assert.deepEqual(trial.installs[0].approval, { pendingBuilds: ['native@1.0.0'], firstAttempt: 'failed', firstError: null })
  assert.deepEqual(trial.entries.afterExtraStart, ['example=ACTIVE'])
  assert.ok(trial.connections.includes('extra start: telemetry.example.com:443 (refused)'))
  assert.deepEqual(trial.network.dshWeb, ['127.0.0.1:5000'])
  assert.deepEqual(trial.network.listeners, ['TCP 127.0.0.1:9080 — node.exe（invoke svc.start）', 'TCP 0.0.0.0:7000 — node.exe（restart）'])
  assert.equal(trial.network.loopbackOnly, false)
  assert.deepEqual(trial.network.direct, ['restart: node.exe → 203.0.113.5:443'])
  assert.deepEqual(trial.network.processes, ['invoke svc.start: node.exe <tmp>\\gateway.cjs'])
  assert.deepEqual(trial.files.map(item => item.checkpoint), ['install'])
  assert.deepEqual(trial.patch.map(item => item.rows), [[], ['webserver']])
  const report = fakeReport()
  const draft = draftEntry({ report, trial, listing: {}, categories, today: '2026-10-20' })
  const markdown = renderRecord({ report, trial, listing: {}, draft, command: 'npm run review -- dsh-example@1.1.0', steps: [], tool: { index: 'abc1234' }, today: '2026-10-20' })
  assert.match(markdown, /构建脚本审批 · Build-script approval/u)
  assert.match(markdown, /`TCP 0\.0\.0\.0:7000 — node\.exe（restart）`；⚠️/u)
  assert.match(markdown, /install：webserver/u)
})

test('the record puts Chinese before English and lists TODOs for an unlisted version', () => {
  const report = fakeReport()
  const trial = summarizeTrial(rawTrial, { names: ['dsh-example'] })
  const draft = draftEntry({ report, trial, listing: {}, categories, today: '2026-10-19' })
  const markdown = renderRecord({ report, trial, listing: {}, draft, command: 'npm run review -- dsh-example@1.1.0', steps: [], tool: { index: 'abc1234' }, today: '2026-10-19' })
  assert.match(markdown, /## 结论 · Verdict\n\n- 结论 · Verdict：\*\*TODO\*\*/u)
  assert.match(markdown, /## 一、包信息 · Package facts/u)
  assert.match(markdown, /```yaml\n {2}- name: dsh-example/u)
})
