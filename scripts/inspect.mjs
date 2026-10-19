#!/usr/bin/env node
/**
 * Reviewer helper: print the facts of one npm version without installing or running it. For a complete review record
 * (static facts, an install trial, and a draft plugins.yml entry) use `npm run review` instead.
 *
 * Usage: node scripts/inspect.mjs <name>[@version] [--target 0.2.1-rc.2] [--deps] [--json] [--grep <regex>]
 *   --deps  resolve the production dependency tree from the registry as an install would today.
 *   --grep  print where the package's text files match a regular expression, to read a hint in context.
 */
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { parse as parseYaml } from 'yaml'
import { inspectVersion } from './lib/inspection.mjs'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    target: { type: 'string' }, deps: { type: 'boolean', default: false }, json: { type: 'boolean', default: false },
    grep: { type: 'string' },
  },
})
if (positionals.length !== 1) {
  console.error('usage: node scripts/inspect.mjs <name>[@version] [--target <dsh version>] [--deps] [--json] [--grep <regex>]')
  process.exit(2)
}
const spec = positionals[0]
const at = spec.lastIndexOf('@')
const name = at > 0 ? spec.slice(0, at) : spec
const target = values.target ?? parseYaml(readFileSync(new URL('../plugins.yml', import.meta.url), 'utf8')).target.dsh

let inspected
try {
  inspected = await inspectVersion(name, at > 0 ? spec.slice(at + 1) : undefined, { target, deps: values.deps })
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
const { report, files } = inspected

if (values.grep !== undefined) {
  const pattern = new RegExp(values.grep, 'u')
  let shown = 0
  for (const [path, bytes] of files.entries()) {
    if (/\.(?:png|jpe?g|webp|gif|ico|woff2?|ttf|wasm|node|map)$/iu.test(path)) continue
    for (const [number, line] of bytes.toString('utf8').split(/\r?\n/u).entries()) {
      const match = pattern.exec(line)
      if (match === null) continue
      const start = Math.max(0, match.index - 70)
      console.log(`${path}:${number + 1}: ${line.slice(start, start + 180).trim()}`)
      if (++shown >= 25) process.exit(0)
    }
  }
  process.exit(0)
}

if (values.json) {
  console.log(JSON.stringify(report, null, 2))
} else {
  for (const [key, value] of Object.entries(report)) console.log(`${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
  console.log(`\nFor a review record with an install trial and a draft plugins.yml entry: npm run review -- ${report.name}@${report.version} --dsh <DSH checkout>`)
}
