import { describe, it, expect } from 'vitest'
import { gzipSync } from 'node:zlib'
import { decodeBody, validateRows } from '../src/decode.js'

const json = JSON.stringify([{ id: '001902', name: 'Cayuga ISD' }])

describe('decodeBody', () => {
  it('parses plain JSON bytes', () => {
    expect(decodeBody(Buffer.from(json))).toEqual([{ id: '001902', name: 'Cayuga ISD' }])
  })

  it('parses gzipped bytes by sniffing the magic number', () => {
    expect(decodeBody(gzipSync(json))).toEqual([{ id: '001902', name: 'Cayuga ISD' }])
  })

  it('preserves leading zeros in ids', () => {
    expect(decodeBody(Buffer.from(json))[0].id).toBe('001902')
  })

  it('throws a useful error on malformed input', () => {
    expect(() => decodeBody(Buffer.from('not json'))).toThrow(/failed to parse/i)
  })
})

describe('validateRows', () => {
  it('accepts an array at or above the floor', () => {
    expect(() => validateRows('districts', [{ id: 'a' }, { id: 'b' }], 2)).not.toThrow()
  })

  it('rejects a short array as a partial publication', () => {
    expect(() => validateRows('districts', [{ id: 'a' }], 2)).toThrow(/districts.*1.*below floor 2/i)
  })

  it('rejects a non-array payload', () => {
    expect(() => validateRows('districts', { id: 'a' }, 1)).toThrow(/expected an array/i)
  })

  it('rejects rows without an id', () => {
    expect(() => validateRows('districts', [{ name: 'x' }], 1)).toThrow(/missing.*id/i)
  })
})
