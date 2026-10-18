#!/usr/bin/env node
/**
 * Validate the curated list: structure, exact pinned versions, existence on npm with matching integrity, the
 * inclusion rules (bundle, OSI license, install scripts, size, DSH compatibility with `target.dsh`), and the
 * generated index against the format-1 validator DSH itself uses. With `--index`, also check that a built
 * `index.json` is valid and equal to what the list generates.
 *
 * Usage: node scripts/validate.mjs [--catalog plugins.yml] [--index dist/index.json]
 * Exit status: 0 when valid, 1 when any rule is violated.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { MarketIndexError, parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'
import { runPipeline } from './lib/pipeline.mjs'
import { printReport } from './lib/report.mjs'

const { values } = parseArgs({ options: { catalog: { type: 'string', default: 'plugins.yml' }, index: { type: 'string' } } })
const result = await runPipeline(resolve(values.catalog))
if (values.index !== undefined) {
  const file = resolve(values.index)
  if (!existsSync(file)) result.errors.push(`${values.index}: does not exist; run npm run build`)
  else {
    const text = readFileSync(file, 'utf8')
    try {
      parseMarketIndex(JSON.parse(text), 'https://index.invalid/index.json')
    } catch (error) {
      result.errors.push(`${values.index}: ${error instanceof MarketIndexError || error instanceof SyntaxError ? error.message : String(error)}`)
    }
    if (result.index !== undefined && text !== `${JSON.stringify(result.index, null, 2)}\n`) result.errors.push(`${values.index}: differs from what ${values.catalog} generates; rebuild it`)
  }
}
printReport(result, `validate ${values.catalog}`)
process.exit(result.errors.length > 0 ? 1 : 0)
