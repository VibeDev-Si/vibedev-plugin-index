#!/usr/bin/env node
/**
 * Publish the built `dist/` to the VibeDev download server so the index is served at
 * https://download.vibedev.studio/plugin-index/index.json. Dry run by default: it prints the files, the remote paths,
 * and every command, and changes nothing. With `--apply` it:
 *   1. checks that dist/index.json is a valid format-1 index and that dist/ holds only regular files;
 *   2. streams dist/ as a tar archive over ssh into <root>/plugin-index.releases/<id>.staging and checks every file's
 *      sha256 on the server;
 *   3. renames the staging directory to <root>/plugin-index.releases/<id> and switches <root>/plugin-index, a symbolic
 *      link, to it with one atomic rename;
 *   4. fetches the public URL over HTTPS without following redirects and requires HTTP 200, a JSON content type, and
 *      the exact bytes of dist/index.json; on failure it switches the link back to the previous release;
 *   5. keeps the newest --keep releases and removes older ones, only inside <root>/plugin-index.releases.
 * Nothing outside <root>/plugin-index, <root>/plugin-index.next, and <root>/plugin-index.releases is touched, and an
 * existing <root>/plugin-index that is not a symbolic link stops the run before anything changes.
 * ssh always runs with BatchMode, StrictHostKeyChecking=yes, the given known_hosts file, and only the given identity.
 *
 * Usage: node scripts/mirror.mjs --ssh user@host --identity <private key> --known-hosts <file> [--apply]
 *        [--dist dist] [--root /data/vibedev-download/public] [--url https://download.vibedev.studio/plugin-index/index.json]
 *        [--keep 5]
 * Requirements: OpenSSH client locally; a POSIX shell with GNU coreutils (mv -T, ln -sfn, sha256sum) and tar on the
 * server; the web server serves <root> and follows the plugin-index symbolic link, without redirecting the URL.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join, posix, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { MarketIndexError, parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'
import { createTar } from './lib/tar.mjs'

const { values } = parseArgs({
  options: {
    ssh: { type: 'string' }, identity: { type: 'string' }, 'known-hosts': { type: 'string' },
    apply: { type: 'boolean', default: false }, dist: { type: 'string', default: 'dist' },
    root: { type: 'string', default: '/data/vibedev-download/public' },
    url: { type: 'string', default: 'https://download.vibedev.studio/plugin-index/index.json' },
    keep: { type: 'string', default: '5' },
  },
})

const NAME = 'plugin-index'
const SAFE_PATH = /^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/u
const SAFE_FILE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u
const fail = (message) => { console.error(`mirror: ${message}`); process.exit(2) }

// ---- arguments ------------------------------------------------------------------------------------------------
if (values.ssh === undefined || !/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/u.test(values.ssh)) fail('--ssh must be user@host (letters, digits, . _ -)')
if (values.identity === undefined || !existsSync(values.identity)) fail('--identity must name an existing private key file')
if (values['known-hosts'] === undefined || !existsSync(values['known-hosts'])) fail('--known-hosts must name an existing known_hosts file that already holds the server key')
if (!SAFE_PATH.test(values.root) || values.root.split('/').includes('..')) fail('--root must be an absolute path of letters, digits, and . _ -')
const keep = Number(values.keep)
if (!Number.isInteger(keep) || keep < 1 || keep > 50) fail('--keep must be an integer from 1 to 50')
const publicUrl = new URL(values.url)
if (publicUrl.protocol !== 'https:') fail('--url must be https')
const dist = resolve(values.dist)

// ---- local files ----------------------------------------------------------------------------------------------
function listFiles(dir) {
  const files = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      const stat = lstatSync(path)
      if (stat.isDirectory()) walk(path)
      else if (stat.isFile()) files.push(path)
      else fail(`${path} is not a regular file or directory`)
    }
  }
  walk(dir)
  return files.map((path) => {
    const name = relative(dir, path).split(sep).join('/')
    if (!SAFE_FILE.test(name)) fail(`refusing file name ${JSON.stringify(name)}`)
    const bytes = readFileSync(path)
    return { name, bytes, sha256: createHash('sha256').update(bytes).digest('hex') }
  }).sort((left, right) => left.name.localeCompare(right.name))
}

if (!existsSync(join(dist, 'index.json'))) fail(`${dist}/index.json does not exist; run npm run build first`)
const files = listFiles(dist)
const index = files.find(file => file.name === 'index.json')
try {
  parseMarketIndex(JSON.parse(index.bytes.toString('utf8')), publicUrl.href)
} catch (error) {
  fail(`dist/index.json is not a valid format-1 index: ${error instanceof MarketIndexError || error instanceof SyntaxError ? error.message : String(error)}`)
}
const digest = createHash('sha256')
for (const file of files) digest.update(`${file.sha256}  ${file.name}\n`)
const release = `${new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d+Z$/u, 'Z')}-${digest.digest('hex').slice(0, 12)}`

// ---- remote layout --------------------------------------------------------------------------------------------
const root = values.root
const link = posix.join(root, NAME)
const nextLink = posix.join(root, `${NAME}.next`)
const releases = posix.join(root, `${NAME}.releases`)
const target = posix.join(releases, release)
const staging = `${target}.staging`
const RELEASE = '[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}'

const sshArgs = [
  '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${resolve(values['known-hosts'])}`,
  '-o', 'IdentitiesOnly=yes', '-i', resolve(values.identity), '--', values.ssh,
]
const manifest = files.map(file => `${file.sha256}  ${file.name}`).join('\n') + '\n'
const steps = {
  check: `set -eu; test ! -e '${link}' || test -L '${link}'; mkdir -p '${releases}'; readlink '${link}' || true`,
  upload: `set -eu; rm -rf -- '${staging}'; mkdir -p '${staging}'; tar --no-same-owner -xf - -C '${staging}'`,
  verify: `set -eu; cd '${staging}'; sha256sum -c --quiet --strict`,
  switch: `set -eu; test ! -e '${link}' || test -L '${link}'; mv -T -- '${staging}' '${target}'; ln -sfn -- '${target}' '${nextLink}'; mv -T -- '${nextLink}' '${link}'; readlink '${link}'`,
  prune: `set -eu; cd '${releases}'; current=$(basename "$(readlink '${link}')"); ls -1 | grep -E '^${RELEASE}$' | sort -r | grep -vx "$current" | tail -n +${keep} | while read -r old; do rm -rf -- '${releases}'/"$old"; done; ls -1`,
  rollback: previous => `set -eu; test -L '${link}'; ln -sfn -- '${previous}' '${nextLink}'; mv -T -- '${nextLink}' '${link}'; readlink '${link}'`,
}

/** Run one remote command; `input` is written to its standard input. */
function ssh(command, input) {
  return new Promise((done, reject) => {
    const child = spawn('ssh', [...sshArgs, command], { stdio: ['pipe', 'pipe', 'inherit'] })
    let stdout = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.on('error', reject)
    child.on('close', code => (code === 0 ? done(stdout.trim()) : reject(new Error(`remote command failed (exit ${code}): ${command}`))))
    child.stdin.end(input)
  })
}

/** Fetch the public URL without following redirects and compare it with dist/index.json. */
async function verifyPublic() {
  const response = await fetch(publicUrl, { redirect: 'manual', headers: { accept: 'application/json' }, cache: 'no-store' })
  const body = Buffer.from(await response.arrayBuffer())
  const type = response.headers.get('content-type') ?? ''
  const problems = [
    ...response.status === 200 ? [] : [`HTTP ${response.status}${response.headers.get('location') ? ` -> ${response.headers.get('location')}` : ''}`],
    ...type.toLowerCase().startsWith('application/json') ? [] : [`content-type ${JSON.stringify(type)}`],
    ...body.equals(index.bytes) ? [] : [`body differs (${body.length} bytes served, ${index.bytes.length} built)`],
  ]
  return { ok: problems.length === 0, status: response.status, type, bytes: body.length, problems }
}

// ---- run ------------------------------------------------------------------------------------------------------
console.log(`${values.apply ? 'APPLY' : 'DRY RUN (add --apply to publish)'}: ${files.length} file(s) from ${dist} -> ${values.ssh}:${link}`)
for (const file of files) console.log(`  ${file.sha256.slice(0, 16)}  ${String(file.bytes.length).padStart(8)}  ${file.name}`)
console.log(`release ${release}\n  staging  ${staging}\n  release  ${target}\n  link     ${link} -> ${target}\n  public   ${publicUrl.href}`)
const ssh0 = ['ssh', ...sshArgs].map(part => (/\s/u.test(part) ? JSON.stringify(part) : part)).join(' ')
for (const [step, command] of Object.entries(steps)) if (step !== 'rollback') console.log(`\n[${step}] ${ssh0} ${JSON.stringify(command)}`)
console.log(`\n[upload] stdin: ustar archive of the files above; [verify] stdin: sha256 manifest of the files above`)
if (!values.apply) process.exit(0)

const previous = await ssh(steps.check)
console.log(`current link target: ${previous || '(none)'}`)
await ssh(steps.upload, createTar(files))
await ssh(steps.verify, manifest)
console.log('server-side sha256 check passed')
console.log(`switched: ${await ssh(steps.switch)}`)
let result
for (let attempt = 1; attempt <= 5; attempt++) {
  result = await verifyPublic().catch(error => ({ ok: false, problems: [error.message] }))
  if (result.ok) break
  await new Promise(done => setTimeout(done, 3000 * attempt))
}
if (!result.ok) {
  console.error(`public check failed: ${result.problems.join('; ')}`)
  if (previous !== '' && new RegExp(`^${releases.replace(/[.]/gu, '\\.')}/${RELEASE}$`, 'u').test(previous)) {
    console.error(`rolled back: ${await ssh(steps.rollback(previous))}`)
  } else console.error('no previous release to roll back to; the new release stays linked')
  process.exit(1)
}
console.log(`public check passed: HTTP ${result.status}, ${result.type}, ${result.bytes} bytes identical to dist/index.json`)
console.log(`releases kept:\n${await ssh(steps.prune)}`)
