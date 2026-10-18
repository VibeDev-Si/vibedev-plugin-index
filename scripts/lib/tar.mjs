/**
 * Minimal in-memory reader for the regular files of a gzip-compressed npm tarball (ustar, pax, and GNU long names).
 * Nothing is written to disk and nothing in the archive is executed; links, directories, and devices are skipped.
 */
import { gunzipSync } from 'node:zlib'

const BLOCK = 512

/** A NUL-terminated header field. */
function field(header, start, length) {
  const end = header.indexOf(0, start)
  return header.toString('utf8', start, end === -1 || end > start + length ? start + length : end)
}

/** A numeric header field: octal text, or base-256 when the high bit of the first byte is set. */
function numeric(header, start, length) {
  if ((header[start] & 0x80) !== 0) {
    let value = header[start] & 0x7f
    for (let i = start + 1; i < start + length; i++) value = value * 256 + header[i]
    return value
  }
  const text = field(header, start, length).trim()
  if (text === '') return 0
  if (!/^[0-7]+$/u.test(text)) throw new Error(`tar header has an invalid number ${JSON.stringify(text)}`)
  return Number.parseInt(text, 8)
}

function checksumMatches(header) {
  let sum = 0
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : header[i]
  return sum === numeric(header, 148, 8)
}

/** Records of a pax extended header: `<length> <key>=<value>\n`. */
function paxRecords(data) {
  const records = {}
  let position = 0
  while (position < data.length) {
    const space = data.indexOf(0x20, position)
    const length = space === -1 ? Number.NaN : Number(data.toString('utf8', position, space))
    if (!Number.isInteger(length) || length <= space - position || position + length > data.length) throw new Error('malformed pax header')
    const record = data.toString('utf8', space + 1, position + length - 1)
    const equals = record.indexOf('=')
    if (equals > 0) records[record.slice(0, equals)] = record.slice(equals + 1)
    position += length
  }
  return records
}

/**
 * Unpack the regular files of a `.tgz` in memory.
 * @param {Uint8Array} compressed - the tarball bytes.
 * @param {{ maxBytes: number }} limits - largest unpacked archive accepted.
 * @returns {Map<string, Buffer>} file contents by archive path, such as `package/package.json`; a later entry wins.
 * @throws {Error} for a corrupt, truncated, or oversized archive.
 */
export function readTarball(compressed, { maxBytes }) {
  let tar
  try {
    tar = gunzipSync(compressed, { maxOutputLength: maxBytes })
  } catch (error) {
    throw new Error(`tarball does not unpack within ${maxBytes} bytes: ${error.message}`)
  }
  const files = new Map()
  let offset = 0
  let pax = {}
  let globalPax = {}
  let longName
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK)
    if (header.every(byte => byte === 0)) break
    if (!checksumMatches(header)) throw new Error(`tar header checksum mismatch at offset ${offset}`)
    const type = header[156] === 0 ? '0' : String.fromCharCode(header[156])
    const size = type !== 'x' && type !== 'g' && pax.size !== undefined ? Number(pax.size) : numeric(header, 124, 12)
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`tar entry at offset ${offset} has an invalid size`)
    const start = offset + BLOCK
    if (start + size > tar.length) throw new Error('truncated tar entry')
    const data = tar.subarray(start, start + size)
    offset = start + Math.ceil(size / BLOCK) * BLOCK
    if (type === 'x') { pax = paxRecords(data); continue }
    if (type === 'g') { globalPax = { ...globalPax, ...paxRecords(data) }; continue }
    if (type === 'L') { longName = data.toString('utf8').replace(/\0+$/u, ''); continue }
    const ustar = header.toString('latin1', 257, 262) === 'ustar'
    const prefix = ustar ? field(header, 345, 155) : ''
    const base = field(header, 0, 100)
    const name = pax.path ?? longName ?? globalPax.path ?? (prefix === '' ? base : `${prefix}/${base}`)
    pax = {}
    longName = undefined
    if (type === '0' || type === '7') files.set(name, Buffer.from(data))
  }
  return files
}
