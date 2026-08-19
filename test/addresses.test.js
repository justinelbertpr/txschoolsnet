import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import {
  addAddressDbf,
  addressStreetShards,
  parseAddressDbf,
  publishAddressStreetShards,
  zipCities,
} from '../src/addresses.js'

const requiredFields = [
  ['FULLNAME', 40],
  ['LFROMHN', 12],
  ['LTOHN', 12],
  ['RFROMHN', 12],
  ['RTOHN', 12],
  ['ZIPL', 5],
  ['ZIPR', 5],
]

function dbf(rows, { fields = requiredFields, deleted = [] } = {}) {
  const headerBytes = 32 + fields.length * 32 + 1
  const recordBytes = 1 + fields.reduce((sum, [, length]) => sum + length, 0)
  const body = Buffer.alloc(headerBytes + rows.length * recordBytes + 1, 0)
  body[0] = 0x03
  body.writeUInt32LE(rows.length, 4)
  body.writeUInt16LE(headerBytes, 8)
  body.writeUInt16LE(recordBytes, 10)

  fields.forEach(([name, length], index) => {
    const offset = 32 + index * 32
    body.write(name, offset, Math.min(11, Buffer.byteLength(name)), 'ascii')
    body[offset + 11] = 0x43 // dBASE character field
    body[offset + 16] = length
  })
  body[headerBytes - 1] = 0x0d

  rows.forEach((row, rowIndex) => {
    let offset = headerBytes + rowIndex * recordBytes
    body[offset] = deleted.includes(rowIndex) ? 0x2a : 0x20
    offset += 1
    for (const [name, length] of fields) {
      const text = Buffer.from(String(row[name] ?? ''), 'latin1')
      body.fill(0x20, offset, offset + length)
      text.copy(body, offset, 0, Math.min(length, text.length))
      offset += length
    }
  })
  body[body.length - 1] = 0x1a
  return body
}

const row = (overrides = {}) => ({
  FULLNAME: 'Cardinal Dr',
  LFROMHN: '22701',
  LTOHN: '22749',
  RFROMHN: '22700',
  RTOHN: '22748',
  ZIPL: '77447',
  ZIPR: '77447',
  ...overrides,
})

describe('parseAddressDbf', () => {
  it('reads and trims required character fields and skips deleted records', () => {
    const parsed = parseAddressDbf(dbf([
      row({ FULLNAME: '  Cardinal Dr  ' }),
      row({ FULLNAME: 'Deleted Rd' }),
    ], { deleted: [1] }))

    expect(parsed).toEqual([row()])
  })

  it('accepts a complete DBF whose optional end-of-file marker is absent', () => {
    const completeWithoutEof = dbf([row()]).subarray(0, -1)
    expect(parseAddressDbf(completeWithoutEof)).toEqual([row()])
  })

  it('rejects missing fields and a record truncated by even one byte', () => {
    const withoutZipR = requiredFields.filter(([name]) => name !== 'ZIPR')
    expect(() => parseAddressDbf(dbf([row()], { fields: withoutZipR })))
      .toThrow('ADDRFEAT DBF is missing ZIPR')

    const complete = dbf([row()])
    expect(() => parseAddressDbf(complete.subarray(0, complete.length - 2)))
      .toThrow('ADDRFEAT DBF is truncated')
  })

  it('rejects headers that cannot describe a DBF record', () => {
    expect(() => parseAddressDbf(Buffer.alloc(12))).toThrow('ADDRFEAT DBF is too small')

    const malformed = dbf([row()])
    malformed.writeUInt16LE(1, 10)
    expect(() => parseAddressDbf(malformed)).toThrow('ADDRFEAT DBF has an invalid header')
  })
})

describe('address range dictionary', () => {
  it('merges both sides and repeated segments into one street/ZIP range', () => {
    const records = new Map()
    addAddressDbf(records, dbf([
      row(),
      row({
        FULLNAME: 'CARDINAL DR',
        LFROMHN: '22801',
        LTOHN: '22819',
        RFROMHN: '22801',
        RTOHN: '22819',
      }),
      row({
        FULLNAME: 'Cardinal Dr',
        LFROMHN: '22999A',
        LTOHN: '22901',
        RFROMHN: '',
        RTOHN: '',
        ZIPR: '',
      }),
      row({ FULLNAME: 'Cardinal Dr', ZIPL: 'not-a-zip', ZIPR: 'not-a-zip' }),
    ]))

    expect([...records.values()]).toEqual([{
      street: 'Cardinal Dr',
      normalized: 'cardinal dr',
      shard: 'c',
      zip: '77447',
      min: 22700,
      max: 22999,
      count: 4,
    }])
  })

  it('groups and sorts compact rows into same-origin shard payloads', () => {
    const records = new Map([
      ['z', { street: 'Zane St', normalized: 'zane st', shard: 'z', zip: '77002', min: 1, max: 99, count: 2 }],
      ['c2', { street: 'Cardinal Dr', normalized: 'cardinal dr', shard: 'c', zip: '77448', min: null, max: null, count: 1 }],
      ['c1', { street: 'Cardinal Dr', normalized: 'cardinal dr', shard: 'c', zip: '77447', min: 22700, max: 22999, count: 4 }],
    ])
    const cities = new Map([['77447', 'Hockley'], ['77002', 'Houston']])
    const shards = addressStreetShards(records, cities)

    expect([...shards.keys()]).toEqual(['z', 'c'])
    expect(shards.get('c')).toEqual([
      ['Cardinal Dr', '77447', 'Hockley', 22700, 22999, 4],
      ['Cardinal Dr', '77448', null, null, null, 1],
    ])
    expect(shards.get('z')).toEqual([
      ['Zane St', '77002', 'Houston', 1, 99, 2],
    ])
  })
})

describe('zipCities', () => {
  it('uses the most common TEA city per ZIP and resolves ties alphabetically', () => {
    const cities = zipCities([
      { zip_5: '77447', city: ' Hockley ' },
      { zip: '77447', city: 'Hockley' },
      { zip_5: '77447', city: 'Houston' },
      { zip_5: '78701', city: 'West Lake Hills' },
      { zip_5: '78701', city: 'Austin' },
      { zip_5: 'bad', city: 'Ignored' },
      { zip_5: '77002', city: '' },
    ])

    expect([...cities]).toEqual([
      ['77447', 'Hockley'],
      ['78701', 'Austin'],
    ])
  })
})

describe('publishAddressStreetShards', () => {
  const scratchDirs = []
  const scratch = async (prefix) => {
    const dir = await mkdtemp(join(tmpdir(), prefix))
    scratchDirs.push(dir)
    return dir
  }
  const sha256 = (value) => createHash('sha256').update(value).digest('hex')

  afterEach(async () => {
    await Promise.all(scratchDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('verifies gzip checksums and publishes validated JSON while clearing stale files', async () => {
    const sourceDir = await scratch('address-source-')
    const targetDir = await scratch('address-target-')
    const payload = JSON.stringify({
      v: 1,
      year: 2025,
      rows: [['Cardinal Dr', '77447', 'Hockley', 22700, 22999, 4]],
    })
    const gz = gzipSync(payload)
    await writeFile(join(sourceDir, 'c.json.gz'), gz)
    await writeFile(join(sourceDir, 'manifest.json'), JSON.stringify({
      v: 1,
      shards: { c: { file: 'c.json.gz', rows: 1, sha256: sha256(gz) } },
    }))
    await writeFile(join(targetDir, 'stale.json'), '{}')

    await expect(publishAddressStreetShards({ sourceDir, targetDir })).resolves.toEqual({
      files: 1,
      rows: 1,
      bytes: Buffer.byteLength(payload),
    })
    expect(await readdir(targetDir)).toEqual(['c.json'])
    expect(await readFile(join(targetDir, 'c.json'), 'utf8')).toBe(payload)
  })

  it('refuses a shard whose bytes do not match the manifest checksum', async () => {
    const sourceDir = await scratch('address-source-')
    const targetDir = await scratch('address-target-')
    const gz = gzipSync(JSON.stringify({ v: 1, rows: [] }))
    await writeFile(join(sourceDir, 'c.json.gz'), gz)
    await writeFile(join(sourceDir, 'manifest.json'), JSON.stringify({
      v: 1,
      shards: { c: { file: 'c.json.gz', rows: 0, sha256: '0'.repeat(64) } },
    }))

    await expect(publishAddressStreetShards({ sourceDir, targetDir }))
      .rejects.toThrow('address street shard c failed its checksum')
    expect(await readdir(targetDir)).toEqual([])
  })

  it('rejects malformed manifests and mismatched row counts', async () => {
    const sourceDir = await scratch('address-source-')
    const targetDir = await scratch('address-target-')
    await writeFile(join(sourceDir, 'manifest.json'), JSON.stringify({ v: 2, shards: {} }))
    await expect(publishAddressStreetShards({ sourceDir, targetDir }))
      .rejects.toThrow('address street manifest is missing or invalid')

    const payload = JSON.stringify({ v: 1, rows: [] })
    const gz = gzipSync(payload)
    await writeFile(join(sourceDir, 'c.json.gz'), gz)
    await writeFile(join(sourceDir, 'manifest.json'), JSON.stringify({
      v: 1,
      shards: { c: { file: 'c.json.gz', rows: 1, sha256: sha256(gz) } },
    }))
    await expect(publishAddressStreetShards({ sourceDir, targetDir }))
      .rejects.toThrow('address street shard c does not match its manifest')
  })
})
