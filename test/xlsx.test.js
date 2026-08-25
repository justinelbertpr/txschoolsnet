import { describe, expect, it } from 'vitest'
import { parseSharedStrings, parseSheetRows, xmlText, xlsxPart, xlsxRows } from '../src/xlsx.js'

describe('XLSX reader', () => {
  it('decodes XML entities and rich shared strings', () => {
    expect(xmlText('A &amp; B &#x2013; &#39;C&#39;')).toBe("A & B – 'C'")
    expect(
      parseSharedStrings(
        '<sst><si><t>Plain</t></si><si><r><t xml:space="preserve">Two </t></r><r><t>&amp; three</t></r></si></sst>'
      )
    ).toEqual(['Plain', 'Two & three'])
  })

  it('preserves missing columns and reads shared, inline, numeric and boolean cells', () => {
    const xml = `<worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><v>42</v></c></row>
      <row r="2"><c r="B2" t="inlineStr"><is><t>A &amp; B</t></is></c><c r="D2" t="b"><v>1</v></c></row>
    </sheetData></worksheet>`
    expect(parseSheetRows(xml, ['Header'])).toEqual([
      ['Header', '', '42'],
      ['', 'A & B', '', 'TRUE'],
    ])
  })

  it('rejects bad shared-string indexes and unsafe archive part names', async () => {
    expect(() => parseSheetRows('<row><c r="A1" t="s"><v>9</v></c></row>', ['only'])).toThrow(
      /shared-string index/
    )
    await expect(xlsxPart('/tmp/nope.xlsx', '../secret')).rejects.toThrow(/unsupported XLSX part/)
    await expect(xlsxRows('/tmp/nope.xlsx', 0)).rejects.toThrow(/sheetNumber/)
  })
})
