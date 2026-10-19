import assert from 'node:assert/strict'
import test from 'node:test'
import { LocalResumeMatchingService, type ResumeMatchConstraint } from '../src/resume-matching.ts'
import type { JobDetails } from '../src/domain.ts'
import type { ResumeTextContent, ResumeVersion } from '../src/resume-version.ts'

// Pins the experience eligibility constraint. BOSS writes the requirement as a
// range ("1-3 年") and obfuscates the dash with U+2011, while the resume states
// tenure as a label ("工作年限：1") or a separated phrase
// ("1 年 AI 应用开发经验"). None of those forms may be silently skipped, and a
// range's upper bound must never be read as the minimum.

const RESUME_VERSION: ResumeVersion = {
  resumeVersionId: 'resume-version:test',
  displayName: 'test',
  localArtifactRef: 'local-resume://sha256:test',
  contentHash: 'a'.repeat(64),
  mediaType: 'application/pdf',
  byteSize: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
}

async function experienceConstraint(jd: string, resume: string): Promise<ResumeMatchConstraint | undefined> {
  const job: JobDetails = {
    applicationId: 'application-test',
    company: '测试公司',
    role: '测试岗位',
    capturedAt: '2026-01-01T00:00:00.000Z',
    contentHash: 'b'.repeat(64),
    description: jd,
    artifactRef: 'local-artifact://test',
  }
  const resumeContent: ResumeTextContent = {
    resumeVersion: RESUME_VERSION,
    text: resume,
    extractionStatus: 'text_extracted',
    characterCount: resume.length,
    sourceByteHash: 'a'.repeat(64),
  }
  const service = new LocalResumeMatchingService({
    source: { getJob: async () => job },
    resumes: { readText: async () => resumeContent },
  })
  const result = await service.match({
    applicationId: 'application-test',
    resumeVersionId: RESUME_VERSION.resumeVersionId,
  })
  return result.hardConstraints.find((constraint) => constraint.field === 'experience')
}

test('reads a U+2011 range requirement and matches a one-year resume', async () => {
  const constraint = await experienceConstraint(
    '本科及以上学历，1\u20113 年大模型企业端实施 / 交付相关工作经验，有企业端落地经验优先。',
    '工作年限：1 专业：数据科学与大数据 毕业院校：某大学',
  )
  assert.ok(constraint !== undefined, 'experience constraint must be produced')
  assert.equal(constraint.required, '1-3年')
  assert.equal(constraint.observed, '1年')
  assert.equal(constraint.status, 'matched')
})

test('does not treat a range upper bound as the minimum', async () => {
  const constraint = await experienceConstraint(
    '岗位要求：1-3年经验，熟悉企业 AI 交付流程。',
    '工作年限：1',
  )
  assert.ok(constraint !== undefined)
  assert.equal(constraint.required, '1-3年')
  assert.equal(constraint.status, 'matched', 'a 1-year candidate satisfies a 1-3 year range')
})

test('still rejects a candidate below an explicit minimum', async () => {
  const constraint = await experienceConstraint(
    '任职要求：3年以上大模型企业端交付经验。',
    '工作年限：1',
  )
  assert.ok(constraint !== undefined)
  assert.equal(constraint.required, '3年')
  assert.equal(constraint.status, 'unmatched')
})

test('accepts a resume whose tenure phrase separates 年 from 经验', async () => {
  const constraint = await experienceConstraint(
    '任职要求：2年及以上相关经验。',
    '自我评价 AI 应用开发：2 年 AI 应用开发经验，负责规则引擎与 RAG 检索。',
  )
  assert.ok(constraint !== undefined)
  assert.equal(constraint.status, 'matched')
  assert.equal(constraint.observed, '2年')
})

test('does not read a date range as a tenure', async () => {
  const constraint = await experienceConstraint(
    '任职要求：熟悉大模型应用交付。',
    '教育经历 2023-2024年 就读于某大学 计算机科学与技术',
  )
  assert.ok(constraint === undefined, 'a date range alone must not create a tenure requirement')
})

test('records unknown when the resume states no tenure', async () => {
  const constraint = await experienceConstraint(
    '任职要求：1-3年经验。',
    '自我评价 熟悉 Python 与 Kafka。',
  )
  assert.ok(constraint !== undefined)
  assert.equal(constraint.status, 'unknown')
  assert.equal(constraint.observed, undefined)
})

test('over-qualification is recorded but never ineligible', async () => {
  const constraint = await experienceConstraint(
    '任职要求：1-3年经验。',
    '工作年限：5',
  )
  assert.ok(constraint !== undefined)
  assert.equal(constraint.required, '1-3年')
  assert.equal(constraint.observed, '5年')
  assert.equal(constraint.status, 'matched', 'a longer tenure must not be scored ineligible')
})

test('emits no experience constraint when the JD states none', async () => {
  const constraint = await experienceConstraint(
    '任职要求：熟悉 Python、RAG 与 Agent 编排。',
    '工作年限：1',
  )
  assert.equal(constraint, undefined)
})
