/**
 * Read-only file tree of an npm package and atomic output writes.
 * Adapted from DeepSeek Harness apps/plugin-market-generator/src/files.ts (dsh-v0.2.1-rc.2),
 * MIT License, Copyright (c) 2026 DeepSeek; see NOTICE.md.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, posix } from 'node:path'

/** Largest manifest or locale file read, in bytes. */
export const MAX_TEXT_FILE_BYTES = 1024 * 1024

/**
 * Write `contents` through a temporary sibling and a rename, leaving the file untouched when it already holds them.
 * @param {string} file - destination path.
 * @param {Uint8Array | string} contents - complete file contents.
 * @returns {boolean} whether the file changed.
 */
export function writeIfChanged(file, contents) {
  const bytes = Buffer.from(contents)
  if (existsSync(file) && readFileSync(file).equals(bytes)) return false
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`
  writeFileSync(temporary, bytes)
  renameSync(temporary, file)
  return true
}

/** Regular files of one package by normalized POSIX path relative to the package root `''`. */
export class PackageFiles {
  #files
  #children = new Map()

  /** @param {Map<string, Buffer>} files - file contents by normalized relative path. */
  constructor(files) {
    this.#files = files
    for (const path of files.keys()) {
      const segments = path.split('/')
      segments.forEach((name, depth) => {
        const dir = segments.slice(0, depth).join('/')
        let children = this.#children.get(dir)
        if (children === undefined) this.#children.set(dir, children = { directories: new Set(), files: [] })
        if (depth === segments.length - 1) children.files.push(name)
        else children.directories.add(name)
      })
    }
  }

  /**
   * The package files of an npm tarball: entries below the archive's top directory, without `node_modules`.
   * @param {Map<string, Buffer>} entries - archive entries from `readTarball`.
   * @returns {PackageFiles} the package tree.
   */
  static fromTarball(entries) {
    const files = new Map()
    for (const [archivePath, bytes] of entries) {
      const path = PackageFiles.resolve('', archivePath.split('/').slice(1).join('/'))
      if (path === undefined || path === '' || path.split('/').includes('node_modules')) continue
      files.set(path, bytes)
    }
    return new PackageFiles(files)
  }

  /**
   * Resolve a relative reference inside the tree.
   * @param {string} base - directory the reference is relative to.
   * @param {string} reference - relative path, possibly starting with `./`.
   * @returns {string | undefined} the normalized path, or undefined when the reference is absolute or leaves the tree.
   */
  static resolve(base, reference) {
    if (posix.isAbsolute(reference) || /^[A-Za-z]:/u.test(reference)) return undefined
    const path = posix.normalize(posix.join(base, reference)).replace(/\/$/u, '')
    if (path === '..' || path.startsWith('../')) return undefined
    return path === '.' ? '' : path
  }

  /** @returns {number} the number of regular files. */
  get count() {
    return this.#files.size
  }

  /** @returns {number} the summed size of all regular files in bytes. */
  get bytes() {
    let total = 0
    for (const contents of this.#files.values()) total += contents.length
    return total
  }

  /** @returns {IterableIterator<[string, Buffer]>} every file. */
  entries() {
    return this.#files.entries()
  }

  /**
   * @param {string} path - normalized file path.
   * @returns {Buffer | undefined} the file, or undefined.
   */
  file(path) {
    return this.#files.get(path)
  }

  /**
   * Read a text file such as a manifest or locale file.
   * @param {string} path - normalized file path.
   * @returns {Buffer | undefined} the contents, or undefined when no regular file has that path.
   * @throws {Error} when the file exceeds MAX_TEXT_FILE_BYTES.
   */
  read(path) {
    const file = this.#files.get(path)
    if (file !== undefined && file.length > MAX_TEXT_FILE_BYTES) throw new Error(`${path} exceeds ${MAX_TEXT_FILE_BYTES} bytes`)
    return file
  }

  /**
   * @param {string} dir - normalized directory path.
   * @returns {string[]} names of the directories directly inside `dir`, sorted.
   */
  directories(dir) {
    return [...this.#children.get(dir)?.directories ?? []].sort()
  }

  /**
   * @param {string} dir - normalized directory path.
   * @returns {string[]} names of the regular files directly inside `dir`, sorted.
   */
  fileNames(dir) {
    return [...this.#children.get(dir)?.files ?? []].sort()
  }
}
