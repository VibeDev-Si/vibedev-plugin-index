/**
 * Text edits to the curated source list that keep every other byte of the file, so an automated change to
 * plugins.yml shows only the lines it adds.
 */
import { isDeepStrictEqual } from 'node:util'
import { Document, isMap, isScalar, isSeq, parse, parseDocument, visit } from 'yaml'

/**
 * Render one version entry as a YAML block list item in the list's style: short lists of scalars in flow style
 * (`[a, b]`), long strings on one line.
 * @param {object} entry - `{ version, integrity, review }`.
 * @returns {string} lines starting with `- `, without indentation, ending in a newline.
 */
export function renderVersionItem(entry) {
  const document = new Document([entry])
  visit(document, {
    Seq(_key, node) {
      if (node.items.every(item => isScalar(item))) node.flow = true
    },
  })
  return document.toString({ lineWidth: 0, flowCollectionPadding: false })
}

/**
 * Append a version to one plugin's `versions` list without reformatting the file.
 * @param {string} text - the current plugins.yml.
 * @param {string} name - the plugin's package name.
 * @param {object} entry - the version entry to append.
 * @returns {string} the new file text.
 * @throws {Error} when the plugin or its block-style versions list is missing, or the edited text would not parse to
 *   exactly the original list plus the entry.
 */
export function appendVersionText(text, name, entry) {
  const document = parseDocument(text, { uniqueKeys: true })
  if (document.errors.length > 0) throw new Error(`plugins.yml does not parse: ${document.errors[0].message}`)
  const plugins = document.get('plugins', true)
  const plugin = isSeq(plugins) ? plugins.items.find(item => isMap(item) && item.get('name') === name) : undefined
  if (plugin === undefined) throw new Error(`${name}: not in plugins.yml`)
  const versions = plugin.get('versions', true)
  if (!isSeq(versions) || versions.flow || versions.items.length === 0) throw new Error(`${name}: versions must be a non-empty block list`)

  const first = versions.items[0]
  const lineStart = text.lastIndexOf('\n', first.range[0] - 1) + 1
  const marker = /^( *)- +$/u.exec(text.slice(lineStart, first.range[0]))
  if (marker === null) throw new Error(`${name}: the first version does not start its own "- " line`)
  const indent = marker[1]

  // Insert after the line holding the end of the last item's value, so trailing comments and blank lines stay below it.
  const last = versions.items.at(-1)
  const newline = text.indexOf('\n', last.range[1] - 1)
  const at = newline === -1 ? text.length : newline + 1
  const block = renderVersionItem(entry).trimEnd().split('\n').map(line => `${indent}${line}`).join('\n')
  const result = `${text.slice(0, at)}${newline === -1 ? '\n' : ''}${block}\n${text.slice(at)}`

  const before = parse(text)
  const after = parse(result, { uniqueKeys: true })
  const expected = structuredClone(before)
  expected.plugins.find(item => item.name === name).versions.push(structuredClone(entry))
  if (!isDeepStrictEqual(after, expected)) throw new Error(`${name}: appending ${entry.version} would change more than its own entry`)
  return result
}
