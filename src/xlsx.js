// Small, dependency-free reader for the narrow XLSX surface used by the
// official TEA and THECB workbooks archived by this project. XLSX is a ZIP of
// XML parts. Fetch scripts use the system `unzip` command to extract those
// parts; builds consume the normalized, checksummed JSON written beside the
// source workbook and never need an office suite or network access.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export function xmlText(value) {
  return String(value ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
}

export function parseSharedStrings(xml) {
  if (typeof xml !== 'string') throw new TypeError('sharedStrings XML must be a string')
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((match) =>
    xmlText(
      [...match[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
        .map((part) => part[1])
        .join('')
    )
  )
}

const columnNumber = (letters) => {
  let n = 0
  for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64
  return n - 1
}

/**
 * Return rows as dense arrays. Blank/missing cells remain empty strings, so a
 * shifted value can never silently become another column's value.
 */
export function parseSheetRows(xml, sharedStrings = []) {
  if (typeof xml !== 'string') throw new TypeError('worksheet XML must be a string')
  const rows = []
  for (const rowMatch of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
    const row = []
    for (const cell of rowMatch[1].matchAll(/<c\s+([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cell[1]
      const ref = /(?:^|\s)r="([A-Z]+)\d+"/.exec(attrs)?.[1]
      if (!ref) throw new Error('worksheet cell is missing an A1 reference')
      const type = /(?:^|\s)t="([^"]+)"/.exec(attrs)?.[1] ?? ''
      const body = cell[2]
      const raw = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? ''
      let value
      if (type === 's') {
        if (!/^\d+$/.test(raw) || Number(raw) >= sharedStrings.length) {
          throw new Error(`worksheet shared-string index ${JSON.stringify(raw)} is invalid`)
        }
        value = sharedStrings[Number(raw)]
      } else if (type === 'inlineStr') {
        value = xmlText(
          [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
            .map((part) => part[1])
            .join('')
        )
      } else if (type === 'b') {
        value = raw === '1' ? 'TRUE' : raw === '0' ? 'FALSE' : raw
      } else {
        value = xmlText(raw)
      }
      row[columnNumber(ref)] = value
    }
    for (let i = 0; i < row.length; i++) if (row[i] == null) row[i] = ''
    rows.push(row)
  }
  return rows
}

/** Extract one part without trusting archive paths supplied by remote data. */
export async function xlsxPart(file, part) {
  if (!/^xl\/(?:sharedStrings\.xml|workbook\.xml|_rels\/workbook\.xml\.rels|worksheets\/sheet\d+\.xml)$/.test(part)) {
    throw new Error(`unsupported XLSX part ${JSON.stringify(part)}`)
  }
  try {
    const { stdout } = await exec('unzip', ['-p', file, part], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
    if (!stdout) throw new Error('empty part')
    return stdout
  } catch (error) {
    throw new Error(`${file}: cannot read ${part} (${error.message})`)
  }
}

export async function xlsxRows(file, sheetNumber = 1) {
  if (!Number.isInteger(sheetNumber) || sheetNumber < 1 || sheetNumber > 99) {
    throw new Error('sheetNumber must be an integer from 1 through 99')
  }
  const [shared, sheet] = await Promise.all([
    xlsxPart(file, 'xl/sharedStrings.xml'),
    xlsxPart(file, `xl/worksheets/sheet${sheetNumber}.xml`),
  ])
  return parseSheetRows(sheet, parseSharedStrings(shared))
}
