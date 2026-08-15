import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resetDir } from '../../src/lib/reset-dir.js'

// resetDir is what src/prerender.js and src/export.js call, scoped to a
// single generated subdirectory (site/district, site/campus, site/data),
// immediately before writing this run's output. Exercised here against a
// scratch directory tree with an absolute path, so the test doesn't depend
// on (or fight over) process.cwd() the way the real callers' relative
// 'site/...' paths do.

let scratch

afterEach(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true })
  scratch = undefined
})

describe('resetDir', () => {
  it('removes a stale file left by a previous run and leaves a sibling directory intact', async () => {
    scratch = await mkdtemp(join(tmpdir(), 'reset-dir-'))

    // Mimics site/: a generated subdirectory (district) with a leftover
    // page from a prior run, plus a hand-authored sibling file that must
    // never be touched.
    const generated = join(scratch, 'district')
    await mkdir(generated, { recursive: true })
    await writeFile(join(generated, '999999.html'), 'stale campus page')
    await writeFile(join(scratch, 'index.html'), 'hand-authored')

    await resetDir(generated)

    expect(await readdir(generated)).toEqual([])
    expect(await readFile(join(scratch, 'index.html'), 'utf8')).toBe('hand-authored')
  })

  it('creates the directory when it does not exist yet, rather than requiring it to pre-exist', async () => {
    scratch = await mkdtemp(join(tmpdir(), 'reset-dir-'))
    const generated = join(scratch, 'campus')

    await resetDir(generated)

    expect(await readdir(generated)).toEqual([])
  })

  it('leaves a second generated directory untouched — the reset is scoped to one path at a time', async () => {
    scratch = await mkdtemp(join(tmpdir(), 'reset-dir-'))
    const district = join(scratch, 'district')
    const campus = join(scratch, 'campus')
    await mkdir(campus, { recursive: true })
    await writeFile(join(campus, '057905001.html'), 'still current')

    await resetDir(district)

    expect(await readFile(join(campus, '057905001.html'), 'utf8')).toBe('still current')
  })
})
