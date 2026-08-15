import { readdir } from 'node:fs/promises'

const LIMIT = 18_000 // Free plan caps at 20,000 assets per Worker version

async function count(dir) {
  let n = 0
  for (const e of await readdir(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? await count(`${dir}/${e.name}`) : 1
  }
  return n
}

const n = await count('site')
console.log(`site/ contains ${n} files (limit ${LIMIT})`)
if (n > LIMIT) {
  console.error(`FAIL: ${n} files exceeds ${LIMIT}. See the design doc §3 — the Paid plan raises this to 100,000.`)
  process.exit(1)
}
