/**
 * The curated source list (`plugins.yml`, schema 1): reading and structural validation.
 * Network facts (does the version exist, does its integrity match, is it compatible) are checked by pipeline.mjs.
 */
import { readFileSync } from 'node:fs'
import semver from 'semver'
import { parse as parseYaml } from 'yaml'

/** Labels the index derives from review records; curators cannot declare these ids themselves. */
export const CAPABILITY_LABELS = {
  'network': { title: { en: 'Uses the network', zh: '联网' } },
  'child-process': { title: { en: 'Runs programs', zh: '运行外部程序' } },
  'writes-files': { title: { en: 'Writes files', zh: '写入文件' } },
  'writes-config': { title: { en: 'Changes DSH settings', zh: '修改 DSH 配置' } },
  'install-scripts': { title: { en: 'Install scripts', zh: '安装脚本' } },
}

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u
const LANGUAGE_ID = /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/u
const ID = /^[a-z0-9][a-z0-9-]*$/u
const INTEGRITY = /^sha512-[A-Za-z0-9+/]{86}==$/u
const DATE = /^\d{4}-\d{2}-\d{2}$/u
/** A host name, `*.domain`, or `*` alone for sites the user or the agent chooses (for example a browser it drives). */
const HOST = /^(?:\*|(?:\*\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?::\d{1,5})?)$/u
const ACCESS = ['none', 'read', 'write']

class Checker {
  errors = []

  fail(path, message) {
    this.errors.push(`${path}: ${message}`)
  }

  object(value, path, allowed, required = []) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.fail(path, 'must be a mapping')
      return undefined
    }
    for (const key of Object.keys(value)) if (!allowed.includes(key)) this.fail(`${path}.${key}`, `unknown field (allowed: ${allowed.join(', ')})`)
    for (const key of required) if (!Object.hasOwn(value, key)) this.fail(`${path}.${key}`, 'is required')
    return value
  }

  string(value, path) {
    if (typeof value !== 'string' || value.trim() === '') {
      this.fail(path, 'must be a non-empty string')
      return undefined
    }
    return value
  }

  localized(value, path) {
    if (typeof value === 'string') return this.string(value, path)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.fail(path, 'must be a string or a mapping of language ids to strings')
      return undefined
    }
    for (const [language, member] of Object.entries(value)) {
      if (!LANGUAGE_ID.test(language)) this.fail(`${path}.${language}`, 'must be a lowercase language id such as en or zh')
      this.string(member, `${path}.${language}`)
    }
    if (!Object.hasOwn(value, 'en')) this.fail(path, 'must contain en')
    return value
  }

  stringList(value, path, pattern, what) {
    if (!Array.isArray(value)) {
      this.fail(path, `must be a list of ${what} ([] for none)`)
      return []
    }
    value.forEach((item, position) => {
      if (typeof item !== 'string' || (pattern !== undefined && !pattern.test(item))) this.fail(`${path}[${position}]`, `must be ${what}`)
    })
    if (new Set(value).size !== value.length) this.fail(path, 'must not repeat an item')
    return value
  }

  declarations(value, path, reserved) {
    const object = value === undefined ? {} : this.object(value, path, Object.keys(value ?? {}))
    for (const [id, title] of Object.entries(object ?? {})) {
      if (!ID.test(id)) this.fail(`${path}.${id}`, 'id must be lowercase letters, digits, and -')
      if (reserved !== undefined && Object.hasOwn(reserved, id)) this.fail(`${path}.${id}`, 'is a capability label the build derives from reviews')
      this.localized(title, `${path}.${id}`)
    }
    return object ?? {}
  }
}

function checkReview(c, value, path, policy) {
  const review = c.object(value, path,
    ['reviewer', 'date', 'license', 'testedOn', 'capabilities', 'installScripts', 'sizeException', 'notes'],
    ['reviewer', 'date', 'license', 'testedOn', 'capabilities', 'installScripts', 'notes'])
  if (review === undefined) return
  c.string(review.reviewer, `${path}.reviewer`)
  if (typeof review.date !== 'string' || !DATE.test(review.date) || Number.isNaN(Date.parse(review.date))) c.fail(`${path}.date`, 'must be a YYYY-MM-DD date')
  else if (Date.parse(review.date) > Date.now() + 86_400_000) c.fail(`${path}.date`, 'is in the future')
  c.string(review.license, `${path}.license`)
  const tested = c.stringList(review.testedOn, `${path}.testedOn`, undefined, 'exact DSH versions')
  if (Array.isArray(review.testedOn) && review.testedOn.length === 0) c.fail(`${path}.testedOn`, 'must name the DSH version(s) the reviewer ran the plugin on')
  tested.forEach((version, position) => { if (semver.valid(version) !== version) c.fail(`${path}.testedOn[${position}]`, 'must be an exact DSH version') })
  const capabilities = c.object(review.capabilities, `${path}.capabilities`, ['network', 'files', 'config', 'childProcess'], ['network', 'files', 'config', 'childProcess'])
  if (capabilities !== undefined) {
    c.stringList(capabilities.network, `${path}.capabilities.network`, HOST, 'host names such as api.example.com, or * for sites the user or agent chooses')
    if (!ACCESS.includes(capabilities.files)) c.fail(`${path}.capabilities.files`, `must be one of ${ACCESS.join(', ')}`)
    if (!ACCESS.includes(capabilities.config)) c.fail(`${path}.capabilities.config`, `must be one of ${ACCESS.join(', ')}`)
    c.stringList(capabilities.childProcess, `${path}.capabilities.childProcess`, undefined, 'program names')
  }
  c.stringList(review.installScripts, `${path}.installScripts`, /^(?:preinstall|install|postinstall|binding\.gyp)$/u, 'preinstall, install, postinstall, or binding.gyp')
  if (review.sizeException !== undefined) c.string(review.sizeException, `${path}.sizeException`)
  c.string(review.notes, `${path}.notes`)
  void policy
}

/**
 * Validate a parsed source list.
 * @param {unknown} value - the parsed YAML document.
 * @returns {{ catalog: object, errors: string[] }} the document and every structural violation.
 */
export function checkCatalog(value) {
  const c = new Checker()
  const root = c.object(value, '$', ['schema', 'index', 'target', 'policy', 'categories', 'labels', 'plugins'], ['schema', 'index', 'target', 'policy', 'categories', 'plugins'])
  if (root === undefined) return { catalog: value, errors: c.errors }
  if (root.schema !== 1) c.fail('$.schema', 'must be 1')
  const index = c.object(root.index, '$.index', ['title', 'description'], ['title'])
  if (index !== undefined) {
    c.localized(index.title, '$.index.title')
    if (index.description !== undefined) c.localized(index.description, '$.index.description')
  }
  const target = c.object(root.target, '$.target', ['dsh'], ['dsh'])
  if (target !== undefined && (typeof target.dsh !== 'string' || semver.valid(target.dsh) !== target.dsh)) c.fail('$.target.dsh', 'must be the exact DSH version VibeDev ships, such as 0.2.1-rc.2')
  const policy = c.object(root.policy, '$.policy', ['maxUnpackedBytes', 'inlineIconBytes'], ['maxUnpackedBytes', 'inlineIconBytes'])
  if (policy !== undefined) {
    if (!Number.isSafeInteger(policy.maxUnpackedBytes) || policy.maxUnpackedBytes < 1) c.fail('$.policy.maxUnpackedBytes', 'must be a positive integer')
    if (!Number.isSafeInteger(policy.inlineIconBytes) || policy.inlineIconBytes < 0 || policy.inlineIconBytes > 32768) c.fail('$.policy.inlineIconBytes', 'must be an integer from 0 to 32768')
  }
  const categories = c.declarations(root.categories, '$.categories')
  const labels = c.declarations(root.labels, '$.labels', CAPABILITY_LABELS)
  if (!Array.isArray(root.plugins)) c.fail('$.plugins', 'must be a list ([] for none)')
  const names = new Set()
  for (const [position, entry] of (Array.isArray(root.plugins) ? root.plugins : []).entries()) {
    const path = `$.plugins[${position}]`
    const plugin = c.object(entry, path, ['name', 'category', 'tags', 'maintainer', 'display', 'versions'], ['name', 'category', 'tags', 'maintainer', 'versions'])
    if (plugin === undefined) continue
    if (typeof plugin.name !== 'string' || plugin.name.length > 214 || !PACKAGE_NAME.test(plugin.name)) c.fail(`${path}.name`, 'must be an npm package name')
    else if (names.has(plugin.name)) c.fail(`${path}.name`, `duplicates ${plugin.name}`)
    names.add(plugin.name)
    if (typeof plugin.category !== 'string' || !Object.hasOwn(categories, plugin.category)) c.fail(`${path}.category`, 'must be a category declared under categories')
    c.stringList(plugin.tags, `${path}.tags`, undefined, 'label ids').forEach((tag, at) => {
      if (!Object.hasOwn(labels, tag)) c.fail(`${path}.tags[${at}]`, `references undeclared label ${JSON.stringify(tag)}`)
    })
    if (typeof plugin.maintainer !== 'string' || !(/^https:\/\/\S+$/u.test(plugin.maintainer) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(plugin.maintainer))) {
      c.fail(`${path}.maintainer`, 'must be an https URL (issue tracker) or an e-mail address where the maintainer answers')
    }
    if (plugin.display !== undefined) {
      const display = c.object(plugin.display, `${path}.display`, ['title', 'description'])
      if (display?.title !== undefined) c.localized(display.title, `${path}.display.title`)
      if (display?.description !== undefined) c.localized(display.description, `${path}.display.description`)
    }
    if (!Array.isArray(plugin.versions) || plugin.versions.length === 0) {
      c.fail(`${path}.versions`, 'must list at least one reviewed version')
      continue
    }
    const versions = new Set()
    for (const [at, member] of plugin.versions.entries()) {
      const vpath = `${path}.versions[${at}]`
      const version = c.object(member, vpath, ['version', 'integrity', 'review'], ['version', 'integrity', 'review'])
      if (version === undefined) continue
      if (typeof version.version !== 'string' || semver.valid(version.version) !== version.version) {
        c.fail(`${vpath}.version`, `must be one exact version such as 1.2.3, not a range or tag (got ${JSON.stringify(version.version)})`)
      } else if (versions.has(version.version)) c.fail(`${vpath}.version`, `duplicates ${version.version}`)
      versions.add(version.version)
      if (typeof version.integrity !== 'string' || !INTEGRITY.test(version.integrity)) c.fail(`${vpath}.integrity`, 'must be the sha512 integrity npm reports (dist.integrity)')
      checkReview(c, version.review, `${vpath}.review`, policy)
    }
  }
  return { catalog: root, errors: c.errors }
}

/**
 * Read and validate a source list file.
 * @param {string} file - path of the YAML file.
 * @returns {{ catalog: object, errors: string[] }} the document and every structural violation.
 */
export function loadCatalog(file) {
  let value
  try {
    value = parseYaml(readFileSync(file, 'utf8'), { uniqueKeys: true, prettyErrors: true })
  } catch (error) {
    return { catalog: undefined, errors: [`${file}: not valid YAML: ${error.message}`] }
  }
  return checkCatalog(value)
}
