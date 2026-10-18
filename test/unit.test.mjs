/** Offline unit tests: tarball reading, manifest rules, list validation, and display metadata. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { checkCatalog } from '../scripts/lib/catalog.mjs'
import { readDisplayMetadata, repositoryUrl } from '../scripts/lib/display.mjs'
import { dshRange, installScripts, isBundle, isOsiLicense, unmetDshRequirements } from '../scripts/lib/manifest.mjs'
import { integrityMatches } from '../scripts/lib/npm.mjs'
import { PackageFiles } from '../scripts/lib/package-files.mjs'
import { readTarball } from '../scripts/lib/tar.mjs'

function header(name, size, type = '0') {
  const block = Buffer.alloc(512)
  block.write(name, 0, 100, 'utf8')
  block.write('0000644\0', 100)
  block.write('0000000\0', 108)
  block.write('0000000\0', 116)
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124)
  block.write('00000000000\0', 136)
  block.write(type, 156)
  block.write('ustar\0', 257)
  block.write('00', 263)
  block.fill(0x20, 148, 156)
  let sum = 0
  for (const byte of block) sum += byte
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148)
  return block
}

function tarball(entries) {
  const blocks = []
  for (const [name, contents, type] of entries) {
    const data = Buffer.from(contents)
    blocks.push(header(name, data.length, type), data, Buffer.alloc((512 - (data.length % 512)) % 512))
  }
  blocks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(blocks))
}

const pax = path => { const record = ` path=${path}\n`; let length = record.length + 2; if (`${length}${record}`.length !== length) length++; return `${length}${record}` }

test('readTarball reads regular files, pax paths, and skips other entries', () => {
  const long = `package/${'d/'.repeat(60)}file.txt`
  const files = readTarball(tarball([
    ['package/package.json', '{"name":"a","version":"1.0.0"}'],
    ['package/dir', '', '5'],
    ['PaxHeader', pax(long), 'x'],
    ['package/short', 'long contents'],
    ['package/link', '', '2'],
  ]), { maxBytes: 1 << 20 })
  assert.deepEqual([...files.keys()], ['package/package.json', long])
  assert.equal(files.get(long).toString(), 'long contents')
  const tree = PackageFiles.fromTarball(files)
  assert.equal(tree.file('package.json').toString(), '{"name":"a","version":"1.0.0"}')
})

test('readTarball rejects corrupt and oversized archives', () => {
  const good = Buffer.concat([header('package/x', 1), Buffer.from('x'), Buffer.alloc(511), Buffer.alloc(1024)])
  const corrupt = Buffer.from(good)
  corrupt[0] ^= 1
  assert.throws(() => readTarball(gzipSync(corrupt), { maxBytes: 1 << 20 }), /checksum/u)
  assert.throws(() => readTarball(gzipSync(good), { maxBytes: 100 }), /does not unpack within 100 bytes/u)
})

test('PackageFiles.fromTarball drops node_modules and paths that leave the package', () => {
  const tree = PackageFiles.fromTarball(new Map([
    ['package/a.js', Buffer.from('a')], ['package/node_modules/x/index.js', Buffer.from('x')], ['package/../../evil', Buffer.from('e')],
  ]))
  assert.deepEqual([...tree.entries()].map(([path]) => path), ['a.js'])
})

test('dshRange follows the generator: engines.dsh wins, peers are conjoined, workspace and * add nothing', () => {
  assert.equal(dshRange({ engines: { dsh: '>=0.2.0' }, peerDependencies: { '@deepseek-ai/dsh-llm': '^0.1.0' } }), '>=0.2.0')
  assert.equal(dshRange({ peerDependencies: { '@deepseek-ai/dsh-llm': '>=0.2.0-rc.2 <0.3.0', '@deepseek-ai/dsh-tools': '>=0.2.0-rc.2 <0.3.0', react: '^18' } }), '>=0.2.0-rc.2 <0.3.0')
  assert.equal(dshRange({ peerDependencies: { '@deepseek-ai/dsh-llm': 'workspace:*', '@deepseek-ai/dsh-tools': '*' } }), undefined)
  assert.equal(dshRange({}), undefined)
  assert.ok(dshRange({ engines: { dsh: 'workspace:^' } }) instanceof Error)
  assert.ok(dshRange({ peerDependencies: { '@deepseek-ai/dsh-a': '^0.1.0', '@deepseek-ai/dsh-b': '^0.2.0' } }) instanceof Error)
})

test('unmetDshRequirements matches DSH install-time checks', () => {
  assert.deepEqual(unmetDshRequirements({ engines: { dsh: '>=0.2.0-rc.2 <0.3.0' } }, '0.2.1-rc.2'), {})
  assert.deepEqual(unmetDshRequirements({ engines: { dsh: '^0.1.0' }, peerDependencies: { '@deepseek-ai/dsh-llm': '*' } }, '0.2.1-rc.2'), { 'engines.dsh': '^0.1.0' })
  assert.deepEqual(unmetDshRequirements({ peerDependencies: { '@deepseek-ai/dsh-fs': '0.1.1-rc.2', '@deepseek-ai/dsh-x': 'workspace:*', other: '1' } }, '0.2.1-rc.2'), { '@deepseek-ai/dsh-fs': '0.1.1-rc.2' })
  assert.deepEqual(unmetDshRequirements({}, '0.2.1-rc.2'), {})
})

test('isBundle, installScripts, and licenses', () => {
  assert.equal(isBundle({ dsh: { bundle: { patch: './cordis.patch.yml' } } }), true)
  assert.equal(isBundle({ dsh: { bundle: {} } }), false)
  const files = new PackageFiles(new Map([['binding.gyp', Buffer.from('{}')]]))
  assert.deepEqual(installScripts({ scripts: { postinstall: 'node x', prepare: 'tsc', test: 'vitest' } }, new PackageFiles(new Map())), ['postinstall'])
  assert.deepEqual(installScripts({}, files), ['binding.gyp'])
  for (const license of ['MIT', 'Apache-2.0', '(MIT OR Apache-2.0)', 'MIT AND Apache-2.0', 'GPL-3.0-or-later']) assert.equal(isOsiLicense(license), true, license)
  for (const license of ['SEE LICENSE IN LICENSE', 'UNLICENSED', 'CC0-1.0', undefined, 'MIT AND Proprietary']) assert.equal(isOsiLicense(license), false, String(license))
})

test('integrityMatches checks sha512 subresource integrity', () => {
  assert.equal(integrityMatches(Buffer.from('abc'), 'sha512-3a81oZNherrMQXNJriBBMRLm+k6JqX6iCp7u5ktV05ohkpkqJ0/BqDa6PCOj/uu9RU1EI2Q86A4qmslPpUyknw=='), true)
  assert.equal(integrityMatches(Buffer.from('abd'), 'sha512-3a81oZNherrMQXNJriBBMRLm+k6JqX6iCp7u5ktV05ohkpkqJ0/BqDa6PCOj/uu9RU1EI2Q86A4qmslPpUyknw=='), false)
})

test('repositoryUrl normalizes hosted shorthands and URLs', () => {
  assert.equal(repositoryUrl('git+https://github.com/o/r.git'), 'https://github.com/o/r')
  assert.equal(repositoryUrl('github:o/r#main'), 'https://github.com/o/r')
  assert.equal(repositoryUrl('o/r'), 'https://github.com/o/r')
  assert.equal(repositoryUrl('git@gitlab.com:group/sub/project.git'), 'https://gitlab.com/group/sub/project')
  assert.equal(repositoryUrl('https://user:pw@git.example.com/a/b.git?x=1'), 'https://git.example.com/a/b')
  assert.equal(repositoryUrl('file:../local'), undefined)
})

test('readDisplayMetadata reads locale files through exports and inlines small icons', () => {
  const files = new PackageFiles(new Map([
    ['locale/en.json', Buffer.from('{"meta":{"title":"Example","description":"English"}}')],
    ['locale/zh.json', Buffer.from('{"meta":{"title":"示例"}}')],
    ['icon.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
  ]))
  const manifest = { name: 'example', description: 'fallback', exports: { './locale/*': './locale/*' }, icon: './icon.svg', author: 'Ann <a@b.c> (https://x)', keywords: ['k'] }
  const { display } = readDisplayMetadata(files, manifest, { inlineBytes: 16384, warn: () => {} })
  assert.deepEqual(display.title, { en: 'Example', zh: '示例' })
  assert.equal(display.description, 'English')
  assert.equal(display.author, 'Ann')
  assert.match(display.icon, /^data:image\/svg\+xml;base64,/u)
  assert.deepEqual(display.keywords, ['k'])
})

const validReview = () => ({
  reviewer: 'r', date: '2026-10-19', license: 'MIT', testedOn: ['0.2.1-rc.2'],
  capabilities: { network: [], files: 'none', config: 'none', childProcess: [] }, installScripts: [], notes: 'n',
})
const catalog = plugins => ({
  schema: 1, index: { title: { en: 'T' } }, target: { dsh: '0.2.1-rc.2' },
  policy: { maxUnpackedBytes: 1, inlineIconBytes: 0 }, categories: { tools: { en: 'Tools' } }, plugins,
})

test('checkCatalog accepts a complete entry and an empty list', () => {
  assert.deepEqual(checkCatalog(catalog([])).errors, [])
  const entry = { name: '@a/b', category: 'tools', tags: [], maintainer: 'https://github.com/a/b/issues', versions: [{ version: '1.0.0', integrity: `sha512-${'A'.repeat(86)}==`, review: validReview() }] }
  assert.deepEqual(checkCatalog(catalog([entry])).errors, [])
})

test('checkCatalog rejects ranges, tags, missing integrity, and capability labels used as curator labels', () => {
  const entry = version => ({ name: 'p', category: 'tools', tags: [], maintainer: 'm@x.io', versions: [{ version, integrity: `sha512-${'A'.repeat(86)}==`, review: validReview() }] })
  for (const version of ['^1.0.0', '1.x', 'latest', '>=1.0.0', '1.0', 'v1.0.0', '*']) {
    assert.ok(checkCatalog(catalog([entry(version)])).errors.some(error => error.includes('must be one exact version')), version)
  }
  const noIntegrity = entry('1.0.0')
  delete noIntegrity.versions[0].integrity
  assert.ok(checkCatalog(catalog([noIntegrity])).errors.some(error => error.endsWith('integrity: is required')))
  const reserved = { ...catalog([]), labels: { network: { en: 'Net' } } }
  assert.ok(checkCatalog(reserved).errors.some(error => error.includes('capability label')))
})
