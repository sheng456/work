import assert from 'node:assert/strict'
import test from 'node:test'
import { LocalResumeMatchingService, type ResumeMatchResult } from '../src/resume-matching.ts'
import {
  DEFAULT_RESUME_MATCH_SCORING,
  requiredItemWeight,
  type ResumeMatchScoringOptions,
} from '../src/resume-match-scoring.ts'
import type { JobDetails } from '../src/domain.ts'
import type { ResumeTextContent, ResumeVersion } from '../src/resume-version.ts'

// Pins the three reviewable scoring behaviours: weighted skills, a location
// preference that informs without deducting, and an explicit question whenever
// an eligibility requirement cannot be confirmed from local evidence.

const RESUME_VERSION: ResumeVersion = {
  resumeVersionId: 'resume-version:scoring-fixture',
  displayName: 'scoring fixture',
  localArtifactRef: 'local-resume://sha256:scoring-fixture',
  contentHash: 's'.repeat(64),
  mediaType: 'text/markdown',
  byteSize: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
}

async function matchFixture(
  description: string,
  text: string,
  scoring?: ResumeMatchScoringOptions,
): Promise<ResumeMatchResult> {
  const job: JobDetails = {
    applicationId: 'application:scoring-fixture',
    company: '虚构评分公司',
    role: '虚构评分岗位',
    capturedAt: '2026-01-01T00:00:00.000Z',
    contentHash: 'j'.repeat(64),
    description,
    artifactRef: 'local-artifact://scoring-fixture',
  }
  const resume: ResumeTextContent = {
    resumeVersion: RESUME_VERSION,
    text,
    extractionStatus: 'text_extracted',
    characterCount: text.length,
    sourceByteHash: 's'.repeat(64),
  }
  const service = new LocalResumeMatchingService({
    source: { getJob: async () => job },
    resumes: { readText: async () => resume },
  })
  return service.match({
    applicationId: 'application:scoring-fixture',
    resumeVersionId: RESUME_VERSION.resumeVersionId,
    ...(scoring === undefined ? {} : { scoring }),
  })
}

test('weights target-direction skills above incidental ones', () => {
  assert.equal(requiredItemWeight('Python', 'technology', DEFAULT_RESUME_MATCH_SCORING), 2)
  assert.equal(requiredItemWeight('React', 'technology', DEFAULT_RESUME_MATCH_SCORING), 1)
  assert.equal(requiredItemWeight('AI Application', 'capability', DEFAULT_RESUME_MATCH_SCORING), 2)
})

test('a matched core skill lifts coverage above the flat ratio', async () => {
  const result = await matchFixture(
    '本科及以上学历，要求 Python、React 与 Vue。',
    '本科。熟悉 Python 与 React。',
  )
  assert.equal(result.skills.missing.includes('Vue'), true)
  // Weighted: (Python 2 + React 1) of (Python 2 + React 1 + Vue 1) = 3/4 -> 45.
  // The old flat ratio (2 of 3 -> 40) scored 80 for the same evidence.
  assert.equal(result.score, 85)
})

test('a single confirmed requirement term cannot reach strong', async () => {
  // Python is weighted 2x, so matching it alone still reaches a raw 80. One
  // confirmed term is nevertheless too little evidence for a strong verdict.
  const result = await matchFixture('本科及以上学历，要求 Python 与 React。', '本科。熟悉 Python。')
  assert.equal(result.skills.matched.length, 1)
  assert.equal(result.score, DEFAULT_RESUME_MATCH_SCORING.matchedEvidenceScoreCap)
  assert.equal(result.matchLevel, 'moderate')
})

test('a location preference informs without deducting points', async () => {
  const jd = '本科及以上学历。工作地点上海。要求 Python 与 React。'
  const resume = '本科，天津。熟悉 Python 与 React。'
  const byDefault = await matchFixture(jd, resume)
  const scoresPreferences = await matchFixture(jd, resume, {
    ...DEFAULT_RESUME_MATCH_SCORING,
    preferenceConstraintsAffectScore: true,
  })

  // The mismatch is reported either way; only its effect on the score differs.
  assert.equal(byDefault.hardConstraints.find((item) => item.field === 'location')?.status, 'unmatched')
  assert.equal(scoresPreferences.hardConstraints.find((item) => item.field === 'location')?.status, 'unmatched')
  assert.equal(byDefault.score, 100)
  assert.equal(scoresPreferences.score, 85)
})

test('a JD with a single requirement term is capped as thin evidence', async () => {
  const result = await matchFixture('本科及以上学历，要求 Python。', '本科。熟悉 Python。')
  assert.equal(result.skills.required.length, 1)
  assert.equal(result.score, DEFAULT_RESUME_MATCH_SCORING.thinJdScoreCap)
  assert.equal(result.matchLevel, 'moderate')
  assert.equal(result.risks.includes('jd_skill_terms_thin'), true)
})

test('asks a question when an eligibility requirement cannot be confirmed', async () => {
  const jd = '本科及以上学历，要求 Python 与 React。'

  const unanswered = await matchFixture(jd, '熟悉 Python 与 React。')
  assert.equal(unanswered.hardConstraints.find((item) => item.field === 'education')?.status, 'unknown')
  assert.equal(unanswered.clarifications.length, 1)
  assert.equal(unanswered.clarifications[0]?.field, 'education')
  assert.match(unanswered.clarifications[0]?.question ?? '', /本科/u)
  assert.equal(unanswered.score, DEFAULT_RESUME_MATCH_SCORING.unknownScoreCap)

  const answered = await matchFixture(jd, '本科。熟悉 Python 与 React。')
  assert.deepEqual(answered.clarifications, [])
})
