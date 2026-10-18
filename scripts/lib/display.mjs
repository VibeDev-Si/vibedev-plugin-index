/**
 * Display metadata of a package read from its files the way DSH reads installed plugins: locale files and the icon
 * are resolved through the package `exports` map, and nothing is evaluated.
 * Adapted from DeepSeek Harness apps/plugin-market-generator/src/metadata.ts (dsh-v0.2.1-rc.2),
 * MIT License, Copyright (c) 2026 DeepSeek; see NOTICE.md. Difference: repository URLs are normalized by
 * `repositoryUrl` below (the hosted-git-info rules for GitHub, GitLab, Bitbucket, and sourcehut) instead of the
 * hosted-git-info package.
 */
import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { exports as resolveExports } from 'resolve.exports'
import { PackageFiles } from './package-files.mjs'

/** Name of an icon file written under `icons/`: a content hash and the image extension. */
export const GENERATED_ICON = /^[0-9a-f]{16}\.(?:svg|png|jpg|jpeg|webp)$/u

const LANGUAGE_ID = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u
const MAX_ICON_BYTES = 256 * 1024
const ICON_TYPES = new Map([['.svg', 'image/svg+xml'], ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp']])
/** One segment of a package directory, as the index format accepts it. */
const PATH_SEGMENT = /^[A-Za-z0-9._@+-]+$/u
const HOSTS = new Map([['github.com', 'github'], ['gitlab.com', 'gitlab'], ['bitbucket.org', 'bitbucket'], ['git.sr.ht', 'sourcehut']])
const SHORTCUTS = new Map([['github', 'github.com'], ['gitlab', 'gitlab.com'], ['bitbucket', 'bitbucket.org'], ['sourcehut', 'git.sr.ht']])

function text(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** Resolve a package subpath through `exports` (import, node, default conditions), or literally without one. */
function resource(manifest, subpath) {
  if (manifest.exports === undefined) return PackageFiles.resolve('', subpath)
  let targets
  try {
    targets = resolveExports({ name: '', exports: manifest.exports }, subpath)
  } catch {
    // resolve.exports throws for a subpath the map does not export.
    return undefined
  }
  return Array.isArray(targets) && typeof targets[0] === 'string' ? PackageFiles.resolve('', targets[0]) : undefined
}

function localeFields(bytes) {
  let parsed
  try {
    parsed = JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    return String(error)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'must be a JSON object'
  const meta = parsed.meta
  if (meta === undefined) return {}
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return 'meta must be an object'
  const fields = {}
  for (const key of ['title', 'description']) {
    if (meta[key] === undefined) continue
    if (text(meta[key]) === undefined) return `meta.${key} must be a non-empty string`
    fields[key] = meta[key]
  }
  return fields
}

/** Locale `meta` fields by lowercase language id, located by `./locale/en.json`. */
function dictionaries(files, manifest, warn) {
  const result = new Map()
  const english = resource(manifest, './locale/en.json')
  if (english === undefined || files.file(english) === undefined) return result
  const dir = posix.dirname(english)
  for (const name of files.fileNames(dir === '.' ? '' : dir)) {
    if (!name.endsWith('.json')) continue
    const language = name.slice(0, -5)
    const path = resource(manifest, `./locale/${name}`)
    const bytes = path === undefined || posix.dirname(path) !== dir ? undefined : files.read(path)
    const fields = !LANGUAGE_ID.test(language) ? 'its name is not a language id'
      : result.has(language.toLowerCase()) ? `duplicates locale ${language.toLowerCase()}`
        : bytes === undefined ? `./locale/${name} does not resolve into ${dir}` : localeFields(bytes)
    if (typeof fields === 'string') warn(`locale file ${posix.join(dir, name)} ignored: ${fields}`)
    else result.set(language.toLowerCase(), fields)
  }
  return result
}

function localized(field, locales, fallback) {
  const translated = [...locales].flatMap(([language, fields]) => fields[field] === undefined ? [] : [[language, fields[field]]])
  if (translated.length === 0) return fallback
  const english = locales.get('en')?.[field] ?? fallback
  if (english === undefined) return undefined
  if (translated.length === 1 && translated[0][0] === 'en') return english
  return Object.fromEntries([['en', english], ...translated.filter(([language]) => language !== 'en')])
}

/**
 * The web page of a manifest `repository` string or object `url`.
 * @param {string} declared - a shorthand (`github:o/r`, `o/r`) or a URL (`git+https://…`, `git@host:o/r.git`).
 * @returns {string | undefined} the repository's https page, or undefined when it names none.
 */
export function repositoryUrl(declared) {
  const value = declared.replace(/#.*$/u, '').trim()
  const shortcut = /^(github|gitlab|bitbucket|sourcehut):\/?(.+)$/u.exec(value)
  if (shortcut !== null) return hostedPage(SHORTCUTS.get(shortcut[1]), shortcut[2])
  if (/^[\w.-]+\/[\w.-]+$/u.test(value) && !value.startsWith('.')) return hostedPage('github.com', value)
  const scp = /^(?:[\w.-]+@)?([\w.-]+):(?!\/\/)(.+)$/u.exec(value)
  if (scp !== null && HOSTS.has(scp[1].toLowerCase())) return hostedPage(scp[1].toLowerCase(), scp[2])
  const plain = value.replace(/^git\+/u, '')
  if (!URL.canParse(plain)) return undefined
  const url = new URL(plain)
  if (HOSTS.has(url.hostname.toLowerCase()) && ['https:', 'http:', 'git:', 'ssh:', 'git+ssh:'].includes(url.protocol)) {
    return hostedPage(url.hostname.toLowerCase(), url.pathname)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
  url.username = ''
  url.password = ''
  url.search = ''
  url.hash = ''
  url.pathname = url.pathname.replace(/\.git$/u, '')
  return url.href
}

/** The browse page of a repository path on a known host: owner and project, or the GitLab group path. */
function hostedPage(host, path) {
  const segments = path.replace(/^\/+|\/+$/gu, '').replace(/\.git$/u, '').split('/').filter(Boolean)
  const kept = HOSTS.get(host) === 'gitlab' ? segments.slice(0, segments.indexOf('-') === -1 ? undefined : segments.indexOf('-')) : segments.slice(0, 2)
  if (kept.length < 2 || kept.some(segment => !/^~?[\w.-]+$/u.test(segment))) return undefined
  return `https://${host}/${kept.join('/')}`
}

function readRepository(value, warn) {
  if (value === undefined) return undefined
  const object = typeof value === 'object' && value !== null ? value : undefined
  const declared = text(object === undefined ? value : object.url)?.trim()
  const url = declared === undefined ? undefined : repositoryUrl(declared)
  if (url === undefined) {
    warn(`package.json repository ${JSON.stringify(value)} names no http(s) repository page; it is omitted`)
    return undefined
  }
  const directory = text(object?.directory)?.replace(/^\.\/|\/$/gu, '')
  const valid = directory !== undefined && directory.split('/').every(segment => segment !== '.' && segment !== '..' && PATH_SEGMENT.test(segment))
  if (object?.directory !== undefined && !valid) warn(`package.json repository.directory ${JSON.stringify(object.directory)} is not a relative directory; it is omitted`)
  return { url, ...valid ? { directory } : {} }
}

function readIcon(files, manifest) {
  let path
  if (manifest.icon === undefined) {
    path = resource(manifest, './icon')
    if (path === undefined || files.file(path) === undefined) return undefined
  } else {
    const declared = text(manifest.icon)
    if (declared === undefined || /^[A-Za-z][A-Za-z\d+.-]*:/u.test(declared)) return 'icon must be a relative file path'
    path = PackageFiles.resolve('', declared)
    if (path === undefined) return `icon ${declared} is outside the package`
  }
  const type = ICON_TYPES.get(posix.extname(path).toLowerCase())
  if (type === undefined) return `icon ${path} must be SVG, PNG, JPEG, or WebP`
  const file = files.file(path)
  if (file === undefined) return `icon ${path} is not a file in the package`
  if (file.length > MAX_ICON_BYTES) return `icon ${path} exceeds 256 KiB`
  return { type, path, bytes: file }
}

/**
 * Read title, description, author, homepage, repository, keywords, and icon of a package.
 * @param {PackageFiles} files - the package files.
 * @param {object} manifest - its parsed package.json.
 * @param {{ inlineBytes: number, warn: (message: string) => void }} options - icon inlining threshold and diagnostics.
 * @returns {{ display: object, iconFile?: { path: string, bytes: Buffer } }} display fields, and the icon file to
 *   publish when the icon is too large to inline.
 */
export function readDisplayMetadata(files, manifest, options) {
  const locales = dictionaries(files, manifest, options.warn)
  const title = localized('title', locales, text(manifest.name))
  const description = localized('description', locales, text(manifest.description))
  // Only the name part of an npm person is published, so no address spreads into the index.
  const person = typeof manifest.author === 'object' && manifest.author !== null ? manifest.author.name : manifest.author
  const author = text(typeof person === 'string' ? person.replace(/<[^>]*>|\([^)]*\)/gu, '').trim() : person)
  const homepage = text(manifest.homepage)
  const linkable = homepage !== undefined && URL.canParse(homepage) && ['https:', 'http:'].includes(new URL(homepage).protocol)
  if (homepage !== undefined && !linkable) options.warn(`package.json homepage ${JSON.stringify(homepage)} is not an http(s) URL; it is omitted`)
  const repository = readRepository(manifest.repository, options.warn)
  const keywords = Array.isArray(manifest.keywords) && manifest.keywords.every(keyword => typeof keyword === 'string') ? manifest.keywords : undefined
  if (manifest.keywords !== undefined && keywords === undefined) options.warn('package.json keywords must be an array of strings; it is omitted')
  const display = {
    ...title === undefined ? {} : { title }, ...description === undefined ? {} : { description }, ...author === undefined ? {} : { author },
    ...linkable ? { homepage } : {},
    ...repository === undefined ? {} : { repository },
    ...keywords === undefined ? {} : { keywords },
  }
  const icon = readIcon(files, manifest)
  if (typeof icon === 'string') options.warn(`${icon}; the icon is omitted`)
  if (typeof icon !== 'object') return { display }
  const { type, path, bytes } = icon
  if (bytes.length <= options.inlineBytes) return { display: { ...display, icon: `data:${type};base64,${bytes.toString('base64')}` } }
  const file = `icons/${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}${posix.extname(path).toLowerCase()}`
  return { display: { ...display, icon: file }, iconFile: { path: file, bytes } }
}
