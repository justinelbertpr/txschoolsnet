import { gunzipSync } from 'node:zlib'

const isGzip = (buf) => buf.length > 1 && buf[0] === 0x1f && buf[1] === 0x8b

/** Bytes -> parsed JSON. Transparently gunzips if the body is still compressed. */
export function decodeBody(buf) {
  const bytes = isGzip(buf) ? gunzipSync(buf) : buf
  const text = bytes.toString('utf8')
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error(`failed to parse JSON (${text.slice(0, 60)}...): ${err.message}`)
  }
}

/** Guards against a partial TEA publication, which otherwise looks like valid data. */
export function validateRows(name, rows, minRows) {
  if (!Array.isArray(rows)) {
    throw new Error(`${name}: expected an array, got ${typeof rows}`)
  }
  if (rows.length < minRows) {
    throw new Error(`${name}: got ${rows.length} rows, below floor ${minRows}`)
  }
  const bad = rows.findIndex((r) => typeof r?.id !== 'string')
  if (bad !== -1) {
    throw new Error(`${name}: row ${bad} missing a string id`)
  }
  return rows
}
