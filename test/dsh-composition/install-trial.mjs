#!/usr/bin/env node
/**
 * Install trial for a review: boot the `web` profile of a built DSH checkout in a temporary DSH_HOME (and temporary
 * USERPROFILE/HOME and pnpm store), install exact versions with `pluginManager.installBundle` — the call Discover's
 * Install makes — and record what each bundle does: entry states, registered tools, skills and HTTP routes, child
 * processes, fetch calls, credential reads, and every outbound connection, which a local proxy logs and refuses
 * unless the host is on the allow list (the npm registry, so pnpm can install). The profile is then booted a second
 * time to observe startup with the bundles installed. Nothing outside the temporary directories is written.
 * `--call "METHOD /path"` invokes a route a bundle registered (on the connection fetch bridge or the web server) once
 * after installation, with an empty JSON body, and records what that call reads and requests.
 *
 * Usage: node test/dsh-composition/install-trial.mjs --dsh <checkout> --pnpm <pnpm.mjs> [--allow host]...
 *        [--call "METHOD /path"]... [--settle ms] [--out report.json] <name@version>...
 */
import childProcess from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { syncBuiltinESMExports } from 'node:module'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dsh: { type: 'string' }, pnpm: { type: 'string' }, allow: { type: 'string', multiple: true },
    call: { type: 'string', multiple: true }, out: { type: 'string' }, settle: { type: 'string', default: '20000' },
  },
})
const calls = (values.call ?? []).map((text) => {
  const match = /^\s*(GET|HEAD|POST|PUT|PATCH|DELETE)\s+(\/\S*)\s*$/iu.exec(text)
  if (match === null) {
    console.error(`--call must look like "POST /api/example": ${JSON.stringify(text)}`)
    process.exit(2)
  }
  return { method: match[1].toUpperCase(), path: match[2] }
})
if (values.dsh === undefined || values.pnpm === undefined || positionals.length === 0) {
  console.error('usage: node test/dsh-composition/install-trial.mjs --dsh <checkout> --pnpm <pnpm.mjs> [--allow host]... [--call "METHOD /path"]... [--out file] <name@version>...')
  process.exit(2)
}
const allow = new Set(values.allow ?? ['registry.npmjs.org'])
const settleMs = Number(values.settle)
const started = Date.now()
const log = { spawns: [], fetches: [], connections: [], credentials: [], tools: [], skills: [], webRoutes: [], connectionRoutes: [], installs: [], states: {}, calls: [] }
let phase = 'setup'
const stamp = () => ({ t: Math.round((Date.now() - started) / 100) / 10, phase })
const short = (value, size = 160) => (String(value).length > size ? `${String(value).slice(0, size)}…` : String(value))

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

// Logging proxy: tunnels only allow-listed hosts; everything else is recorded and refused.
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
  upstream.on('error', () => { response.writeHead(502).end() })
  request.pipe(upstream)
})
proxy.on('connect', (request, socket, head) => {
  const [host, port = '443'] = String(request.url).split(':')
  const allowed = allow.has(host)
  log.connections.push({ ...stamp(), kind: 'connect', target: request.url, allowed })
  if (!allowed) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return }
  const upstream = net.connect(Number(port), host, () => {
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    upstream.write(head)
    upstream.pipe(socket)
    socket.pipe(upstream)
  })
  upstream.on('error', () => { socket.destroy() })
  socket.on('error', () => { upstream.destroy() })
})
await new Promise(done => proxy.listen(0, '127.0.0.1', done))
const proxyUrl = `http://127.0.0.1:${proxy.address().port}`

const root = realpathSync(mkdtempSync(join(tmpdir(), 'vibedev-install-trial-')))
const env = {
  DSH_HOME: join(root, 'dsh-home'), USERPROFILE: join(root, 'user'), HOME: join(root, 'user'),
  npm_config_store_dir: join(root, 'pnpm-store'), npm_config_cache: join(root, 'npm-cache'),
  HTTPS_PROXY: proxyUrl, HTTP_PROXY: proxyUrl, https_proxy: proxyUrl, http_proxy: proxyUrl,
  NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
  DEEPSEEK_API_KEY: 'sk-install-trial-dummy-key',
}
Object.assign(process.env, env)

const checkout = resolve(values.dsh)
const load = async path => await import(pathToFileURL(join(checkout, path)).href)
const { loadLayeredEnv, getDshRuntimeVersion } = await load('packages/boot/app-boot/lib/index.js')
log.dshVersion = getDshRuntimeVersion()
const { runProfile } = await load('apps/cli/lib/profile-boot.js')
const port = await new Promise((done) => { const probe = net.createServer().listen(0, '127.0.0.1', () => { const { port: free } = probe.address(); probe.close(() => done(free)) }) })
const packageManager = { command: process.execPath, args: [resolve(values.pnpm)] }
const FIBER = ['PENDING', 'LOADING', 'ACTIVE', 'FAILED', 'DISPOSED', 'UNLOADING']

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

const sleep = ms => new Promise(done => setTimeout(done, ms))
const names = positionals.map(spec => spec.slice(0, spec.lastIndexOf('@')))
let ctx
try {
  ctx = await boot('boot1')
  await sleep(3000)
  const baselineRoutes = new Set(connectionRoutes(ctx).map(route => route.path))
  for (const spec of positionals) {
    phase = `install:${spec}`
    const result = await ctx.pluginManager.installBundle(spec, { registry: 'https://registry.npmjs.org/', saveExact: true })
    log.installs.push({ spec, application: result.application, stage: result.stage, bundle: result.bundle, version: result.version, enabled: result.enabled,
      error: result.error?.message, exitCode: result.packageResult?.exitCode, kind: result.packageResult?.kind, pendingBuilds: result.pendingBuilds,
      output: result.application === 'applied' ? undefined : short(result.packageResult?.output, 800) })
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
  await ctx.fiber.dispose()
  ctx = undefined

  ctx = await boot('boot2')
  phase = 'idle2'
  await sleep(settleMs)
  for (const name of names) log.states[`boot2:${name}`] = await bundleStates(ctx, name)
} catch (error) {
  log.failure = error instanceof Error ? `${error.message}\n${short(error.stack, 1200)}` : String(error)
} finally {
  phase = 'teardown'
  try { await ctx?.fiber.dispose() } catch (error) { log.disposeError = String(error) }
  proxy.close()
  for (const route of log.webRoutes) delete route.route
  const report = JSON.stringify({ dsh: checkout, root, env: { ...env, DEEPSEEK_API_KEY: '(dummy)' }, ...log }, null, 2)
  if (values.out !== undefined) writeFileSync(values.out, `${report}\n`)
  else console.log(report)
  try { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }) } catch (error) { console.error(`could not delete ${root}: ${error.message}`) }
  process.exit(log.failure === undefined ? 0 : 1)
}
