#!/usr/bin/env node
/**
 * Install trial for a review: boot the `web` profile of a built DSH checkout in temporary directories (DSH_HOME,
 * USERPROFILE/HOME, APPDATA/LOCALAPPDATA, TEMP, and the pnpm store and caches), install exact versions with
 * `pluginManager.installBundle` — the call Discover's Install makes — and record what each bundle does: entry states,
 * registered tools, skills and HTTP routes, child processes, fetch calls, credential reads, every outbound connection
 * through the environment proxy (a local proxy logs it and refuses it unless the host is on the allow list, the npm
 * registry by default, so pnpm can install), and on Windows the listening sockets, direct non-loopback connections,
 * and processes of the whole trial process tree, sampled every few seconds. It also records the files written under
 * the temporary directories and the rows of the profile patch. The profile is booted a second time to observe a
 * restart, and optionally a third time with extra environment variables after deleting files under DSH_HOME.
 * Processes left running after the last stop are reported and killed. Nothing outside the temporary directories is
 * written by the harness.
 *
 * Options:
 *   --call "METHOD /path"         invoke a route a bundle registered (connection fetch bridge or web server) once after
 *                                 installation, with an empty JSON body, and record what that call reads and requests.
 *   --invoke <service>.<method>   call a method of a service a bundle provides once after installation, without
 *                                 arguments (for example the action its UI runs on first use), and record what it
 *                                 starts, opens, and requests.
 *   --approve-builds <package>    when an installation stops on pending dependency build scripts and every pending
 *                                 package is listed here, retry once with `approvedBuilds` (the Plugins page's
 *                                 "Allow these scripts and retry").
 *   --extra-start-env KEY=VALUE   boot a third time with this environment variable set (repeatable).
 *   --extra-start-reset <path>    delete this path, relative to DSH_HOME, before the third start (repeatable).
 *
 * Usage: node test/dsh-composition/install-trial.mjs --dsh <checkout> --pnpm <pnpm.mjs> [--allow host]...
 *        [--call "METHOD /path"]... [--invoke <service>.<method>]... [--approve-builds <package>]... [--extra-start-env KEY=VALUE]...
 *        [--extra-start-reset <path>]... [--settle ms] [--out report.json] <name@version>...
 */
import childProcess from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { syncBuiltinESMExports } from 'node:module'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dsh: { type: 'string' }, pnpm: { type: 'string' }, allow: { type: 'string', multiple: true },
    call: { type: 'string', multiple: true }, out: { type: 'string' }, settle: { type: 'string', default: '20000' },
    'approve-builds': { type: 'string', multiple: true }, invoke: { type: 'string', multiple: true },
    'extra-start-env': { type: 'string', multiple: true }, 'extra-start-reset': { type: 'string', multiple: true },
  },
})
const fail = (message) => { console.error(message); process.exit(2) }
const calls = (values.call ?? []).map((text) => {
  const match = /^\s*(GET|HEAD|POST|PUT|PATCH|DELETE)\s+(\/\S*)\s*$/iu.exec(text)
  if (match === null) fail(`--call must look like "POST /api/example": ${JSON.stringify(text)}`)
  return { method: match[1].toUpperCase(), path: match[2] }
})
const invokes = (values.invoke ?? []).map((text) => {
  const match = /^([A-Za-z_$][\w$.]*)\.([A-Za-z_$][\w$]*)$/u.exec(text)
  if (match === null) fail(`--invoke must look like service.method: ${JSON.stringify(text)}`)
  return { service: match[1], method: match[2], text }
})
const extraEnv = Object.fromEntries((values['extra-start-env'] ?? []).map((text) => {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(text)
  if (match === null) fail(`--extra-start-env must look like KEY=VALUE: ${JSON.stringify(text)}`)
  return [match[1], match[2]]
}))
const extraReset = (values['extra-start-reset'] ?? []).map((path) => {
  if (path === '' || /^[\\/]|^[A-Za-z]:|(?:^|[\\/])\.\.(?:[\\/]|$)/u.test(path)) fail(`--extra-start-reset must be a relative path inside DSH_HOME: ${JSON.stringify(path)}`)
  return path
})
const extraStart = Object.keys(extraEnv).length > 0 || extraReset.length > 0
const approvable = new Set(values['approve-builds'] ?? [])
if (values.dsh === undefined || values.pnpm === undefined || positionals.length === 0) {
  fail('usage: node test/dsh-composition/install-trial.mjs --dsh <checkout> --pnpm <pnpm.mjs> [--allow host]... [--call "METHOD /path"]... [--approve-builds <package>]... [--extra-start-env KEY=VALUE]... [--extra-start-reset <path>]... [--out file] <name@version>...')
}
const allow = new Set(values.allow ?? ['registry.npmjs.org'])
const settleMs = Number(values.settle)
const started = Date.now()
const log = {
  spawns: [], fetches: [], connections: [], credentials: [], tools: [], skills: [], webRoutes: [], connectionRoutes: [], installs: [],
  states: {}, calls: [], files: [], patches: [], network: { supported: process.platform === 'win32', samples: 0, errors: [], listeners: [], remote: [], processes: [] },
  leftoverProcesses: [], extraStart: extraStart ? { env: extraEnv, reset: extraReset } : undefined,
}
let phase = 'setup'
const stamp = () => ({ t: Math.round((Date.now() - started) / 100) / 10, phase })
const short = (value, size = 160) => (String(value).length > size ? `${String(value).slice(0, size)}…` : String(value))
const sleep = ms => new Promise(done => setTimeout(done, ms))

// The sampler and the cleanup use the unwrapped functions, so they never appear among the plugin's processes.
const raw = { execFile: childProcess.execFile, execFileSync: childProcess.execFileSync }

// Child processes: patch the CommonJS exports and resync the ESM bindings, so `import { spawn }` sees the wrapper.
for (const name of ['spawn', 'execFile', 'exec', 'fork', 'spawnSync', 'execFileSync', 'execSync']) {
  const original = childProcess[name]
  childProcess[name] = function (file, ...rest) {
    const args = Array.isArray(rest[0]) ? rest[0] : []
    log.spawns.push({ ...stamp(), call: name, file: short(file, 200), args: args.map(arg => short(arg, 120)) })
    return original.call(this, file, ...rest)
  }
}
for (const module of [http, https]) {
  const original = module.request
  module.request = function (...args) {
    const first = args[0]
    const url = typeof first === 'string' || first instanceof URL ? String(first) : `${first?.protocol ?? ''}//${first?.hostname ?? first?.host ?? ''}${first?.path ?? ''}`
    log.fetches.push({ ...stamp(), via: module === http ? 'http.request' : 'https.request', url: short(url) })
    return original.apply(this, args)
  }
}
syncBuiltinESMExports()
const originalFetch = globalThis.fetch
globalThis.fetch = async function (input, init) {
  const request = new Request(input, init)
  log.fetches.push({ ...stamp(), via: 'fetch', method: request.method, url: short(request.url), authorization: request.headers.has('authorization') })
  return originalFetch(input, init)
}

// Logging proxy: tunnels only allow-listed hosts; everything else is recorded and refused. The local ports of its own
// upstream sockets are remembered, so the network sampler does not report the proxy's allowed traffic.
const proxyUpstream = new Set()
const proxy = http.createServer((request, response) => {
  let host = '?'
  try { host = new URL(request.url).hostname } catch { /* not an absolute URL: refused below */ }
  const allowed = allow.has(host)
  log.connections.push({ ...stamp(), kind: 'http', target: short(request.url), allowed })
  if (!allowed) { response.writeHead(403).end('refused by install trial proxy'); return }
  const upstream = http.request(request.url, { method: request.method, headers: request.headers }, (reply) => {
    response.writeHead(reply.statusCode ?? 502, reply.headers)
    reply.pipe(response)
  })
  upstream.on('socket', socket => socket.once('connect', () => { proxyUpstream.add(socket.localPort) }))
  upstream.on('error', () => { response.writeHead(502).end() })
  request.pipe(upstream)
})
proxy.on('connect', (request, socket, head) => {
  const [host, port = '443'] = String(request.url).split(':')
  const allowed = allow.has(host)
  log.connections.push({ ...stamp(), kind: 'connect', target: request.url, allowed })
  if (!allowed) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return }
  const upstream = net.connect(Number(port), host, () => {
    proxyUpstream.add(upstream.localPort)
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    upstream.write(head)
    upstream.pipe(socket)
    socket.pipe(upstream)
  })
  upstream.on('error', () => { socket.destroy() })
  socket.on('error', () => { upstream.destroy() })
})
await new Promise(done => proxy.listen(0, '127.0.0.1', done))
const proxyPort = proxy.address().port
const proxyUrl = `http://127.0.0.1:${proxyPort}`

const root = realpathSync(mkdtempSync(join(tmpdir(), 'vibedev-install-trial-')))
const dirs = { home: join(root, 'dsh-home'), user: join(root, 'user'), tmp: join(root, 'tmp') }
const env = {
  DSH_HOME: dirs.home, USERPROFILE: dirs.user, HOME: dirs.user,
  APPDATA: join(dirs.user, 'AppData', 'Roaming'), LOCALAPPDATA: join(dirs.user, 'AppData', 'Local'), TEMP: dirs.tmp, TMP: dirs.tmp,
  npm_config_store_dir: join(root, 'pnpm-store'), npm_config_cache_dir: join(root, 'pnpm-cache'), npm_config_cache: join(root, 'npm-cache'),
  HTTPS_PROXY: proxyUrl, HTTP_PROXY: proxyUrl, https_proxy: proxyUrl, http_proxy: proxyUrl,
  NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
  DEEPSEEK_API_KEY: 'sk-install-trial-dummy-key',
}
for (const dir of [dirs.home, dirs.tmp, env.APPDATA, env.LOCALAPPDATA]) mkdirSync(dir, { recursive: true })
Object.assign(process.env, env)

const checkout = resolve(values.dsh)
const load = async path => await import(pathToFileURL(join(checkout, path)).href)
const { loadLayeredEnv, getDshRuntimeVersion } = await load('packages/boot/app-boot/lib/index.js')
log.dshVersion = getDshRuntimeVersion()
const { runProfile } = await load('apps/cli/lib/profile-boot.js')
const port = await new Promise((done) => { const probe = net.createServer().listen(0, '127.0.0.1', () => { const { port: free } = probe.address(); probe.close(() => done(free)) }) })
const packageManager = { command: process.execPath, args: [resolve(values.pnpm)] }
const FIBER = ['PENDING', 'LOADING', 'ACTIVE', 'FAILED', 'DISPOSED', 'UNLOADING']
log.ports = { dshWeb: port, trialProxy: proxyPort }

// ---- process-tree sampler (Windows) --------------------------------------------------------------------------------

const SAMPLE_SCRIPT = `
$ErrorActionPreference='SilentlyContinue'
$root=${process.pid}
$procs=@(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,CommandLine)
$kids=@{}; foreach($p in $procs){ $k=[int]$p.ParentProcessId; if(-not $kids.ContainsKey($k)){ $kids[$k]=New-Object System.Collections.ArrayList }; [void]$kids[$k].Add($p) }
$set=New-Object 'System.Collections.Generic.HashSet[int]'; [void]$set.Add($root)
$queue=New-Object System.Collections.Queue; $queue.Enqueue($root)
while($queue.Count -gt 0){ $id=$queue.Dequeue(); if($kids.ContainsKey($id)){ foreach($c in $kids[$id]){ $cid=[int]$c.ProcessId; if($cid -eq $PID){ continue }; if($set.Add($cid)){ $queue.Enqueue($cid) } } } }
$byId=@{}; foreach($p in $procs){ $byId[[int]$p.ProcessId]=$p }
$plist=@(foreach($id in $set){ $p=$byId[$id]; if($p){ [pscustomobject]@{ pid=$id; ppid=[int]$p.ParentProcessId; name=[string]$p.Name; cmd=[string]$p.CommandLine } } })
$tcp=@(Get-NetTCPConnection | Where-Object { $set.Contains([int]$_.OwningProcess) } | ForEach-Object { [pscustomobject]@{ pid=[int]$_.OwningProcess; state=[string]$_.State; local=[string]$_.LocalAddress; lport=[int]$_.LocalPort; remote=[string]$_.RemoteAddress; rport=[int]$_.RemotePort } })
$udp=@(Get-NetUDPEndpoint | Where-Object { $set.Contains([int]$_.OwningProcess) } | ForEach-Object { [pscustomobject]@{ pid=[int]$_.OwningProcess; local=[string]$_.LocalAddress; lport=[int]$_.LocalPort } })
[pscustomobject]@{ procs=$plist; tcp=$tcp; udp=$udp } | ConvertTo-Json -Depth 4 -Compress
`
const LOOPBACK = address => /^127\./u.test(address) || address === '::1' || address === '::ffff:127.0.0.1'
const UNSPECIFIED = address => address === '0.0.0.0' || address === '::'
const sampler = {
  running: false, waiters: [], loop: undefined,
  listeners: new Map(), remote: new Map(), processes: new Map(),
  async sample() {
    const at = phase
    const output = await new Promise((done) => {
      raw.execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SAMPLE_SCRIPT],
        { windowsHide: true, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => { done(error ? { error } : { stdout }) })
    })
    if (output.error !== undefined) { if (log.network.errors.length < 5) log.network.errors.push(short(output.error.message, 200)); return undefined }
    let data
    try { data = JSON.parse(output.stdout) } catch { return undefined }
    const list = value => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value])
    const procs = new Map(list(data.procs).map(item => [item.pid, item]))
    for (const item of procs.values()) {
      if (item.pid === process.pid) continue
      const known = this.processes.get(item.pid)
      if (known === undefined) this.processes.set(item.pid, { pid: item.pid, ppid: item.ppid, name: item.name, cmd: short(item.cmd ?? '', 240), firstPhase: at, lastPhase: at })
      else known.lastPhase = at
    }
    const nameOf = pid => (pid === process.pid ? 'trial process (DSH)' : procs.get(pid)?.name ?? this.processes.get(pid)?.name ?? '?')
    const touch = (map, key, make) => { const known = map.get(key); if (known === undefined) map.set(key, { ...make(), firstPhase: at, lastPhase: at, count: 1 }); else { known.lastPhase = at; known.count += 1 } }
    for (const item of list(data.tcp)) {
      if (item.state === 'Listen') {
        touch(this.listeners, `TCP ${item.local}:${item.lport} ${item.pid}`, () => ({ proto: 'TCP', address: item.local, port: item.lport, pid: item.pid, process: nameOf(item.pid),
          role: item.pid === process.pid && item.lport === port ? 'dsh-web' : item.pid === process.pid && item.lport === proxyPort ? 'trial-proxy' : undefined }))
        continue
      }
      if (LOOPBACK(item.remote) || UNSPECIFIED(item.remote)) continue
      if (item.pid === process.pid && proxyUpstream.has(item.lport)) continue
      touch(this.remote, `${item.pid} ${item.remote}:${item.rport}`, () => ({ pid: item.pid, process: nameOf(item.pid), remote: item.remote, port: item.rport, state: item.state }))
    }
    for (const item of list(data.udp)) {
      touch(this.listeners, `UDP ${item.local}:${item.lport} ${item.pid}`, () => ({ proto: 'UDP', address: item.local, port: item.lport, pid: item.pid, process: nameOf(item.pid) }))
    }
    log.network.samples += 1
    for (const done of this.waiters.splice(0)) done()
    return procs
  },
  start() {
    if (!log.network.supported || this.running) return
    this.running = true
    this.loop = (async () => { while (this.running) { await this.sample(); await sleep(1000) } })()
  },
  /** Resolve after the next completed sample (immediately when sampling is unsupported). */
  next() { return log.network.supported && this.running ? new Promise(done => this.waiters.push(done)) : Promise.resolve() },
  async stop() { this.running = false; await this.loop; for (const done of this.waiters.splice(0)) done() },
}

// ---- files and the profile patch -----------------------------------------------------------------------------------

// Package trees and pnpm's own state, plus DSH's per-start internals (the Node compile cache and the Windows ACL skill copy).
const SKIP = /(?:^|[\\/])(?:node_modules|\.pnpm-store|node-compile-cache)(?:[\\/]|$)|^AppData[\\/]Local[\\/](?:pnpm|Microsoft[\\/]Windows[\\/]PowerShell)|^dsh-acl-skill-/u
function tree() {
  const files = new Map()
  for (const [label, dir] of Object.entries(dirs)) {
    const walk = (current) => {
      let entries
      try { entries = readdirSync(current, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        const path = join(current, entry.name)
        const rel = relative(dir, path)
        if (SKIP.test(rel)) continue
        if (entry.isDirectory()) walk(path)
        else if (entry.isFile()) {
          try { const stat = lstatSync(path); files.set(`${label}/${rel.split(sep).join('/')}`, `${stat.size}:${Math.round(stat.mtimeMs)}`) } catch { /* removed meanwhile */ }
        }
      }
    }
    walk(dir)
  }
  return files
}
let lastTree = new Map()
function checkpoint(label) {
  const now = tree()
  const sizeOf = key => Number((now.get(key) ?? lastTree.get(key) ?? '0:0').split(':')[0])
  const added = [...now.keys()].filter(key => !lastTree.has(key)).sort()
  const changed = [...now.keys()].filter(key => lastTree.has(key) && lastTree.get(key) !== now.get(key)).sort()
  const removed = [...lastTree.keys()].filter(key => !now.has(key)).sort()
  const cap = keys => keys.slice(0, 80).map(key => `${key} (${sizeOf(key)} B)`)
  log.files.push({ checkpoint: label, added: cap(added), changed: cap(changed), removed: cap(removed), counts: { added: added.length, changed: changed.length, removed: removed.length } })
  lastTree = now
  const patchFile = join(dirs.home, 'profiles', 'web', 'cordis.patch.yml')
  const text = existsSync(patchFile) ? readFileSync(patchFile, 'utf8') : undefined
  log.patches.push({
    checkpoint: label, exists: text !== undefined,
    sha256: text === undefined ? null : createHash('sha256').update(text).digest('hex').slice(0, 16),
    rows: text === undefined ? [] : [...text.matchAll(/^\s*-\s*id:\s*['"]?([^'"\s#]+)/gmu)].map(match => match[1]),
    text: text === undefined ? null : short(text, 2500),
  })
}

// ---- DSH ----------------------------------------------------------------------------------------------------------

async function boot(label) {
  phase = label
  const { ctx } = await runProfile({ environment: loadLayeredEnv('dsh'), profile: 'web', patchFiles: [], args: ['--port', String(port), '--no-open'], packageManager })
  wrap(ctx)
  return ctx
}

/** Record later registrations and credential reads on the live services. */
function wrap(ctx) {
  const hook = (service, method, record) => {
    if (service === undefined || typeof service[method] !== 'function' || service[method].trialWrapped) return
    const original = service[method]
    const wrapped = function (...args) { record(...args); return original.apply(this, args) }
    wrapped.trialWrapped = true
    service[method] = wrapped
  }
  hook(ctx.get('tools'), 'register', definition => log.tools.push({ ...stamp(), name: definition?.name }))
  hook(ctx.get('skills'), 'register', skill => log.skills.push({ ...stamp(), name: skill?.name, source: skill?.source }))
  hook(ctx.get('webServer'), 'register', route => log.webRoutes.push({ ...stamp(), path: route?.path, kind: route?.kind, route }))
  hook(ctx.get('credentials'), 'resolve', name => log.credentials.push({ ...stamp(), name: typeof name === 'string' ? name : JSON.stringify(name) }))
}

/** Routes registered on the Host connection's `/api` fetch bridge (`connection.fetch` is a fresh facade per read). */
function connectionRoutes(ctx) {
  const routes = ctx.get('connection')?.fetchRoutes
  if (!(routes instanceof Map)) return []
  return [...routes].map(([path, route]) => ({ path, methods: [...route.methods], fetch: route.fetch }))
}

async function bundleStates(ctx, name) {
  const bundle = (await ctx.pluginManager.listBundles()).find(item => item.name === name)
  const entries = [...ctx.loader.entries()]
  return {
    enabled: bundle?.enabled, installed: bundle?.installed, version: bundle?.version, error: bundle?.error?.message,
    rows: (bundle?.rows ?? []).map((row) => {
      const entry = entries.find(item => item.id === row.entryId || item.options.id === row.rowId)
      const state = entry?.fiber?.state
      return { row: row.rowId, module: row.moduleName, state: state === undefined ? 'not mounted' : FIBER[state] ?? state, error: entry?.fiber?.error === undefined ? undefined : short(entry.fiber.error, 300) }
    }),
  }
}

const attempt = (result, approvedBuilds) => ({
  application: result.application, stage: result.stage, version: result.version, enabled: result.enabled, error: result.error?.message,
  exitCode: result.packageResult?.exitCode, kind: result.packageResult?.kind, pendingBuilds: result.pendingBuilds,
  ...approvedBuilds === undefined ? {} : { approvedBuilds },
  output: result.application === 'applied' ? undefined : short(result.packageResult?.output, 800),
})

const names = positionals.map(spec => spec.slice(0, spec.lastIndexOf('@')))
let ctx
try {
  ctx = await boot('boot1')
  sampler.start()
  await sleep(3000)
  await sampler.next()
  checkpoint('baseline')
  const baselineRoutes = new Set(connectionRoutes(ctx).map(route => route.path))
  for (const spec of positionals) {
    phase = `install:${spec}`
    const options = { registry: 'https://registry.npmjs.org/', saveExact: true }
    let result = await ctx.pluginManager.installBundle(spec, options)
    const attempts = [attempt(result)]
    const pending = Array.isArray(result.pendingBuilds) ? result.pendingBuilds : []
    // pnpm reports pending builds as name@version; --approve-builds may name the package alone.
    if (result.application !== 'applied' && pending.length > 0 && pending.every(item => approvable.has(item) || approvable.has(String(item).replace(/(.)@[^@]*$/u, '$1')))) {
      result = await ctx.pluginManager.installBundle(spec, { ...options, approvedBuilds: pending })
      attempts.push(attempt(result, pending))
    }
    log.installs.push({ spec, bundle: result.bundle, ...attempts.at(-1), attempts })
    await sleep(settleMs)
  }
  phase = 'states1'
  for (const name of names) log.states[`boot1:${name}`] = await bundleStates(ctx, name)
  const bridge = connectionRoutes(ctx)
  log.connectionRoutes = bridge.filter(route => !baselineRoutes.has(route.path)).map(route => ({ path: route.path, methods: route.methods }))

  for (const { method, path } of calls) {
    phase = `call:${method} ${path}`
    const before = { credentials: log.credentials.length, fetches: log.fetches.length, spawns: log.spawns.length, connections: log.connections.length }
    const record = { method, path, kind: 'missing' }
    try {
      const viaBridge = bridge.find(route => route.path === path && route.methods.includes(method))
      const viaServer = log.webRoutes.find(item => item.path === path && typeof item.route?.handler === 'function')
      const body = method === 'GET' || method === 'HEAD' ? undefined : '{}'
      if (viaBridge !== undefined) {
        record.kind = 'connection'
        const response = await viaBridge.fetch(new Request(`http://127.0.0.1${path}`, { method, headers: { 'content-type': 'application/json' }, body }))
        Object.assign(record, { status: response.status, body: short(await response.text(), 300) })
      } else if (viaServer !== undefined) {
        record.kind = 'webServer'
        const reply = { status: 0, chunks: [] }
        const request = Object.assign(new (await import('node:stream')).Readable({ read() { this.push(body ?? null); if (body !== undefined) this.push(null) } }),
          { method, url: path, headers: { host: '127.0.0.1', 'content-type': 'application/json' } })
        await new Promise((done) => {
          const response = {
            statusCode: 200,
            writeHead(status) { reply.status = status; return this },
            setHeader() {}, getHeader() {}, write(chunk) { reply.chunks.push(String(chunk)); return true },
            end(chunk) { if (chunk !== undefined) reply.chunks.push(String(chunk)); if (reply.status === 0) reply.status = this.statusCode; done() },
            on() { return this }, once() { return this },
          }
          Promise.resolve(viaServer.route.handler(request, response)).catch((error) => { reply.status = -1; reply.chunks.push(String(error)); done() })
          setTimeout(done, 15000).unref()
        })
        Object.assign(record, { status: reply.status, body: short(reply.chunks.join(''), 300) })
      }
    } catch (error) {
      record.error = short(error instanceof Error ? error.message : error, 300)
    }
    await sleep(1000)
    Object.assign(record, {
      credentialReads: log.credentials.slice(before.credentials).map(item => item.name),
      fetches: log.fetches.slice(before.fetches).map(item => `${item.method ?? ''} ${item.url}${item.authorization ? ' (Authorization)' : ''}`.trim()),
      spawns: log.spawns.slice(before.spawns).map(item => [item.file, ...item.args].join(' ')),
      connections: log.connections.slice(before.connections).map(item => `${item.target}${item.allowed ? '' : ' (refused)'}`),
    })
    log.calls.push(record)
  }
  for (const { service, method, text } of invokes) {
    phase = `call:invoke ${text}`
    const before = { credentials: log.credentials.length, fetches: log.fetches.length, spawns: log.spawns.length, connections: log.connections.length }
    const record = { method: 'invoke', path: text, kind: 'service' }
    try {
      const target = ctx.get(service)
      if (typeof target?.[method] !== 'function') throw new Error(`no service method ${text}`)
      const value = await Promise.race([target[method](), sleep(60_000).then(() => { throw new Error('timed out after 60 s') })])
      record.status = 'returned'
      record.body = short(JSON.stringify(value ?? null), 300)
    } catch (error) {
      record.error = short(error instanceof Error ? error.message : error, 300)
    }
    await sleep(3000)
    await sampler.next()
    Object.assign(record, {
      credentialReads: log.credentials.slice(before.credentials).map(item => item.name),
      fetches: log.fetches.slice(before.fetches).map(item => `${item.method ?? ''} ${item.url}${item.authorization ? ' (Authorization)' : ''}`.trim()),
      spawns: log.spawns.slice(before.spawns).map(item => [item.file, ...item.args].join(' ')),
      connections: log.connections.slice(before.connections).map(item => `${item.target}${item.allowed ? '' : ' (refused)'}`),
    })
    log.calls.push(record)
  }
  await sampler.next()
  checkpoint('install')
  await ctx.fiber.dispose()
  ctx = undefined

  ctx = await boot('boot2')
  phase = 'idle2'
  await sleep(settleMs)
  await sampler.next()
  for (const name of names) log.states[`boot2:${name}`] = await bundleStates(ctx, name)
  checkpoint('restart')

  if (extraStart) {
    await ctx.fiber.dispose()
    ctx = undefined
    phase = 'reset3'
    for (const path of extraReset) {
      const target = resolve(dirs.home, path)
      if (!target.startsWith(dirs.home + sep)) throw new Error(`--extra-start-reset ${path} leaves DSH_HOME`)
      rmSync(target, { recursive: true, force: true })
    }
    Object.assign(process.env, extraEnv)
    ctx = await boot('boot3')
    phase = 'idle3'
    await sleep(settleMs)
    await sampler.next()
    for (const name of names) log.states[`boot3:${name}`] = await bundleStates(ctx, name)
    checkpoint('extra start')
  }
} catch (error) {
  log.failure = error instanceof Error ? `${error.message}\n${short(error.stack, 1200)}` : String(error)
} finally {
  phase = 'teardown'
  try { await ctx?.fiber.dispose() } catch (error) { log.disposeError = String(error) }
  await sleep(3000)
  await sampler.stop()
  if (log.network.supported) {
    const procs = await sampler.sample()
    for (const item of procs?.values() ?? []) {
      if (item.pid === process.pid) continue
      log.leftoverProcesses.push({ pid: item.pid, name: item.name, cmd: short(item.cmd ?? '', 240) })
      try { raw.execFileSync('taskkill', ['/PID', String(item.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) } catch { /* already gone */ }
    }
  }
  log.network.listeners = [...sampler.listeners.values()]
  log.network.remote = [...sampler.remote.values()]
  log.network.processes = [...sampler.processes.values()]
  proxy.close()
  for (const route of log.webRoutes) delete route.route
  const report = JSON.stringify({ dsh: checkout, root, env: { ...env, DEEPSEEK_API_KEY: '(dummy)' }, ...log }, null, 2)
  if (values.out !== undefined) writeFileSync(values.out, `${report}\n`)
  else console.log(report)
  // Node may still write its compile cache under TEMP at exit; the caller removes `root` again after this process ends.
  try { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }) } catch (error) { console.error(`could not delete ${root} yet: ${error.message}`) }
  process.exit(log.failure === undefined ? 0 : 1)
}
