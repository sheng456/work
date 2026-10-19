import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { deflateRawSync } from 'node:zlib'
import { LocalResumeImportService, SqliteResumeVersionStore } from '../src/resume-version.ts'

// This suite pins the pure-JavaScript extraction fallbacks. `pdftotext` and
// `unzip` are absent on a stock Windows host, so resume matching must still
// work without them.

/** A minimal, valid, single-page PDF holding one WinAnsi text run. */
function synthesisPdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const object of objects) {
    offsets.push(pdf.length)
    pdf += object
  }
  const xrefStart = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** A minimal, valid DOCX (deflate-compressed `word/document.xml`). */
function synthesisDocx(documentXml: string): Buffer {
  const name = Buffer.from('word/document.xml', 'utf8')
  const raw = Buffer.from(documentXml, 'utf8')
  const compressed = deflateRawSync(raw, { level: 9 })
  const crc = crc32(raw)

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(8, 8)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(compressed.length, 18)
  local.writeUInt32LE(raw.length, 22)
  local.writeUInt16LE(name.length, 26)
  const localRecord = Buffer.concat([local, name, compressed])

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(8, 10)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(compressed.length, 20)
  central.writeUInt32LE(raw.length, 24)
  central.writeUInt16LE(name.length, 28)
  const centralRecord = Buffer.concat([central, name])

  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(centralRecord.length, 12)
  end.writeUInt32LE(localRecord.length, 16)

  return Buffer.concat([localRecord, centralRecord, end])
}

test('extracts PDF text without a pdftotext binary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'boss-watch-resume-pdf-'))
  const store = new SqliteResumeVersionStore(':memory:')
  const service = new LocalResumeImportService({ resumeRoot: root, store })
  const expected = 'Resume evidence AI application development Kafka'
  const pdf = synthesisPdf(expected)
  await writeFile(join(root, 'candidate.pdf'), pdf)

  try {
    const preview = await service.preview({ fileName: 'candidate.pdf', displayName: '候选人简历' })
    assert.equal(preview.contentHash, createHash('sha256').update(pdf).digest('hex'))
    const applied = await service.apply(preview.previewToken)
    const content = await service.readText(applied.resumeVersion.resumeVersionId)
    assert.equal(content.extractionStatus, 'text_extracted')
    assert.ok(content.characterCount > 0)
    assert.match(content.text, /Resume evidence AI application development Kafka/u)
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('extracts DOCX text without unzip or textutil', async () => {
  const root = await mkdtemp(join(tmpdir(), 'boss-watch-resume-docx-'))
  const store = new SqliteResumeVersionStore(':memory:')
  const service = new LocalResumeImportService({ resumeRoot: root, store })
  const documentXml = '<?xml version="1.0"?><w:document><w:body>'
    + '<w:p><w:r><w:t>Resume DOCX evidence</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t>RAG prompt engineering</w:t></w:r></w:p>'
    + '</w:body></w:document>'
  await writeFile(join(root, 'candidate.docx'), synthesisDocx(documentXml))

  try {
    const preview = await service.preview({ fileName: 'candidate.docx', displayName: '候选人简历' })
    const applied = await service.apply(preview.previewToken)
    const content = await service.readText(applied.resumeVersion.resumeVersionId)
    assert.equal(content.extractionStatus, 'text_extracted')
    assert.match(content.text, /Resume DOCX evidence/u)
    assert.match(content.text, /RAG prompt engineering/u)
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})
