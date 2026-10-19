import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  DEFAULT_RESUME_MATCH_SCORING,
  requiredItemWeight,
  type ResumeMatchScoringOptions,
} from './resume-match-scoring.js'
import type { BossWatchDataSource } from './domain.js'
import type { LocalResumeImportService, ResumeTextContent } from './resume-version.js'

export type ResumeMatchLevel = 'strong' | 'moderate' | 'weak' | 'insufficient_evidence'
export type ResumeConstraintStatus = 'matched' | 'unmatched' | 'unknown'
export type ResumeConstraintType = 'eligibility' | 'preference'
export type ResumeCapabilityLabel =
  | 'Backend Engineering'
  | 'Full-stack Delivery'
  | 'Frontend Engineering'
  | 'AI Application'
  | 'API Integration'
  | 'Performance Optimization'
  | 'Test Automation'
  | 'CI/CD'
  | 'Cloud/DevOps'
  | 'Data Engineering'

export interface ResumeMatchConstraint {
  readonly field: 'education' | 'cohort' | 'location' | 'experience'
  readonly constraintType: ResumeConstraintType
  readonly status: ResumeConstraintStatus
  readonly required?: string
  readonly observed?: string
  readonly requiresUserConfirmation?: true
}

/**
 * A question the matcher cannot answer from local evidence.
 *
 * Raised whenever an eligibility constraint stays `unknown`, so the missing
 * evidence becomes an explicit question for the candidate instead of only a
 * silent score cap.
 */
export interface ResumeMatchClarification {
  readonly field: ResumeMatchConstraint['field']
  readonly constraintType: ResumeConstraintType
  readonly required?: string
  readonly question: string
}

export interface ResumeSummary {
  readonly education: {
    readonly highestLevel?: '大专' | '本科' | '硕士' | '博士'
    readonly status: 'observed' | 'not_observed'
  }
  readonly cohorts: readonly string[]
  readonly locations: readonly string[]
  readonly technologies: readonly string[]
  readonly capabilities: readonly ResumeCapabilityLabel[]
  readonly projects: {
    readonly total: number
    readonly directions: readonly {
      readonly label: ResumeCapabilityLabel
      readonly count: number
    }[]
    readonly detection: 'section_blocks' | 'not_observed'
  }
}

export interface ResumeMatchResult {
  readonly matchId: string
  readonly strategyVersion: 'local-evidence-match-v5'
  readonly createdAt: string
  readonly applicationId: string
  readonly jd: {
    readonly company: string
    readonly role: string
    readonly capturedAt: string
    readonly contentHash: string
  }
  readonly resume: {
    readonly resumeVersionId: string
    readonly contentHash: string
    readonly mediaType: string
  }
  readonly extraction: {
    readonly status: ResumeTextContent['extractionStatus']
    readonly characterCount: number
  }
  readonly resumeSummary: ResumeSummary
  readonly hardConstraints: readonly ResumeMatchConstraint[]
  /** Explicit questions for every eligibility constraint left `unknown`. */
  readonly clarifications: readonly ResumeMatchClarification[]
  readonly skills: {
    readonly required: readonly string[]
    readonly matched: readonly string[]
    readonly missing: readonly string[]
    readonly requiredTechnologies: readonly string[]
    readonly matchedTechnologies: readonly string[]
    readonly missingTechnologies: readonly string[]
    readonly requiredCapabilities: readonly ResumeCapabilityLabel[]
    readonly matchedCapabilities: readonly ResumeCapabilityLabel[]
    readonly missingCapabilities: readonly ResumeCapabilityLabel[]
  }
  readonly score: number
  readonly matchLevel: ResumeMatchLevel
  readonly evidence: readonly {
    readonly kind: 'skill' | 'capability' | 'hard_constraint' | 'preference_constraint'
    readonly item: string
    readonly status: ResumeConstraintStatus | 'matched'
  }[]
  readonly gaps: readonly string[]
  readonly risks: readonly string[]
  readonly requiresGateA: true
}

export interface ResumeMatchStore {
  save(result: ResumeMatchResult): ResumeMatchResult
  get(matchId: string): ResumeMatchResult | undefined
  list(options?: { applicationId?: string; limit?: number }): ResumeMatchResult[]
  count(): number
  close(): void
}

export class SqliteResumeMatchStore implements ResumeMatchStore {
  readonly #database: DatabaseSync
  #closed = false

  constructor(path: string) {
    if (path.trim().length === 0) throw new Error('invalid_database_path')
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.#database = new DatabaseSync(path)
    this.#database.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS resume_match_results (
        match_id TEXT PRIMARY KEY,
        application_id TEXT NOT NULL,
        resume_version_id TEXT NOT NULL,
        jd_content_hash TEXT NOT NULL CHECK (length(jd_content_hash) = 64),
        resume_content_hash TEXT NOT NULL CHECK (length(resume_content_hash) = 64),
        strategy_version TEXT NOT NULL,
        created_at TEXT NOT NULL,
        result_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS resume_match_results_application ON resume_match_results(application_id, created_at DESC, match_id ASC);
    `)
  }

  save(result: ResumeMatchResult): ResumeMatchResult {
    this.#assertOpen()
    const existing = this.get(result.matchId)
    if (existing !== undefined) return existing
    this.#database.prepare(`
      INSERT INTO resume_match_results (
        match_id, application_id, resume_version_id, jd_content_hash, resume_content_hash,
        strategy_version, created_at, result_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      result.matchId,
      result.applicationId,
      result.resume.resumeVersionId,
      result.jd.contentHash,
      result.resume.contentHash,
      result.strategyVersion,
      result.createdAt,
      JSON.stringify(result),
    )
    return result
  }

  get(matchId: string): ResumeMatchResult | undefined {
    this.#assertOpen()
    const row = this.#database.prepare('SELECT result_json FROM resume_match_results WHERE match_id = ?').get(matchId) as { result_json: string } | undefined
    return row === undefined ? undefined : JSON.parse(row.result_json) as ResumeMatchResult
  }

  list(options: { applicationId?: string; limit?: number } = {}): ResumeMatchResult[] {
    this.#assertOpen()
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100)
    const rows = options.applicationId === undefined
      ? this.#database.prepare('SELECT result_json FROM resume_match_results ORDER BY created_at DESC, match_id ASC LIMIT ?').all(limit)
      : this.#database.prepare('SELECT result_json FROM resume_match_results WHERE application_id = ? ORDER BY created_at DESC, match_id ASC LIMIT ?').all(options.applicationId, limit)
    return (rows as unknown as { result_json: string }[]).map(row => JSON.parse(row.result_json) as ResumeMatchResult)
  }

  count(): number {
    this.#assertOpen()
    const row = this.#database.prepare('SELECT COUNT(*) AS total FROM resume_match_results').get() as { total: number }
    return row.total
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#database.close()
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('database_closed')
  }
}

export class LocalResumeMatchingService {
  readonly #source: Pick<BossWatchDataSource, 'getJob'>
  readonly #resumes: Pick<LocalResumeImportService, 'readText'>
  readonly #now: () => Date
  readonly #store: ResumeMatchStore | undefined

  constructor(input: {
    readonly source: Pick<BossWatchDataSource, 'getJob'>
    readonly resumes: Pick<LocalResumeImportService, 'readText'>
    readonly store?: ResumeMatchStore
    readonly now?: () => Date
  }) {
    this.#source = input.source
    this.#resumes = input.resumes
    this.#store = input.store
    this.#now = input.now ?? (() => new Date())
  }

  async match(input: {
    readonly applicationId: string
    readonly resumeVersionId: string
    /** Overrides the default scoring parameters; omitted callers keep the defaults. */
    readonly scoring?: ResumeMatchScoringOptions
  }): Promise<ResumeMatchResult> {
    const applicationId = requireText(input.applicationId, 'application_id')
    const job = await this.#source.getJob(applicationId)
    if (job === undefined) throw new Error('resume_match_job_not_found')
    const resume = await this.#resumes.readText(input.resumeVersionId)
    const normalizedJd = normalizeText(job.description)
    const normalizedResume = normalizeText(resume.text)
    const requiredTechnologies = extractTechnologies(normalizedJd)
    const matchedTechnologies = requiredTechnologies.filter((skill) => containsSkill(normalizedResume, skill))
    const missingTechnologies = requiredTechnologies.filter((skill) => !matchedTechnologies.includes(skill))
    const resumeTechnologies = extractTechnologies(normalizedResume)
    const requiredCapabilities = extractCapabilities(normalizedJd, requiredTechnologies, false)
    const resumeCapabilities = extractCapabilities(normalizedResume, resumeTechnologies, true)
    const matchedCapabilities = requiredCapabilities.filter((capability) => resumeCapabilities.includes(capability))
    const missingCapabilities = requiredCapabilities.filter((capability) => !matchedCapabilities.includes(capability))
    const requiredSkills = [...requiredTechnologies, ...requiredCapabilities]
    const matchedSkills = [...matchedTechnologies, ...matchedCapabilities]
    const missingSkills = [...missingTechnologies, ...missingCapabilities]
    const hardConstraints = extractHardConstraints(normalizedJd, normalizedResume)
    const scoring = input.scoring ?? DEFAULT_RESUME_MATCH_SCORING
    const score = calibratedScore(
      scoreMatch({
        requiredTechnologies,
        matchedTechnologies,
        requiredCapabilities,
        matchedCapabilities,
        constraints: hardConstraints,
        scoring,
      }),
      resume.extractionStatus,
      hardConstraints,
      requiredSkills.length,
      matchedSkills.length,
      scoring,
    )
    const matchLevel = levelFor(score, resume.extractionStatus, requiredSkills.length, hardConstraints, scoring)
    const clarifications = buildClarifications(hardConstraints)
    const createdAt = this.#now().toISOString()
    const matchId = `resume-match:${createHash('sha256')
      .update(`${applicationId}\n${job.contentHash}\n${resume.resumeVersion.contentHash}\nlocal-evidence-match-v5`)
      .digest('hex')}`
    const evidence = [
      ...matchedTechnologies.map((item) => ({ kind: 'skill' as const, item, status: 'matched' as const })),
      ...missingTechnologies.map((item) => ({ kind: 'skill' as const, item, status: 'unknown' as const })),
      ...matchedCapabilities.map((item) => ({ kind: 'capability' as const, item, status: 'matched' as const })),
      ...missingCapabilities.map((item) => ({ kind: 'capability' as const, item, status: 'unknown' as const })),
      ...hardConstraints.map((constraint) => ({
        kind: constraint.constraintType === 'preference' ? 'preference_constraint' as const : 'hard_constraint' as const,
        item: constraint.field,
        status: constraint.status,
      })),
    ]
    const gaps = [
      ...missingSkills.map((skill) => `missing_skill:${skill}`),
      ...hardConstraints
        .filter((constraint) => constraint.constraintType === 'eligibility' && constraint.status === 'unmatched')
        .map((constraint) => `hard_constraint:${constraint.field}`),
      ...hardConstraints
        .filter((constraint) => constraint.constraintType === 'eligibility' && constraint.status === 'unknown')
        .map((constraint) => `evidence_missing:${constraint.field}`),
      ...hardConstraints
        .filter((constraint) => constraint.constraintType === 'preference' && constraint.status === 'unmatched')
        .map((constraint) => `preference_mismatch:${constraint.field}`),
      ...hardConstraints
        .filter((constraint) => constraint.constraintType === 'preference' && constraint.status === 'unknown')
        .map((constraint) => `preference_evidence_missing:${constraint.field}`),
    ]
    const risks = [
      ...(resume.extractionStatus === 'text_truncated' ? ['resume_text_truncated'] : []),
      ...(requiredSkills.length === 0 ? ['jd_skill_terms_not_observed'] : []),
      ...(requiredSkills.length > 0 && requiredSkills.length < scoring.minRequiredSkillsForFullCredit
        ? ['jd_skill_terms_thin']
        : []),
      ...(hardConstraints.some((constraint) => constraint.constraintType === 'eligibility' && constraint.status === 'unknown') ? ['hard_constraint_not_observed'] : []),
      ...(hardConstraints.some((constraint) => constraint.field === 'location' && constraint.status !== 'matched') ? ['location_preference_needs_confirmation'] : []),
    ]
    const result: ResumeMatchResult = {
      matchId,
      strategyVersion: 'local-evidence-match-v5',
      createdAt,
      applicationId,
      jd: {
        company: job.company,
        role: job.role,
        capturedAt: job.capturedAt,
        contentHash: job.contentHash,
      },
      resume: {
        resumeVersionId: resume.resumeVersion.resumeVersionId,
        contentHash: resume.resumeVersion.contentHash,
        mediaType: resume.resumeVersion.mediaType,
      },
      extraction: {
        status: resume.extractionStatus,
        characterCount: resume.characterCount,
      },
      resumeSummary: summarizeResume(resume.text, normalizedResume, resumeTechnologies, resumeCapabilities),
      hardConstraints,
      clarifications,
      skills: {
        required: requiredSkills,
        matched: matchedSkills,
        missing: missingSkills,
        requiredTechnologies,
        matchedTechnologies,
        missingTechnologies,
        requiredCapabilities,
        matchedCapabilities,
        missingCapabilities,
      },
      score,
      matchLevel,
      evidence,
      gaps,
      risks,
      requiresGateA: true,
    }
    return this.#store?.save(result) ?? result
  }
}

const SKILL_ALIASES: readonly [string, readonly string[]][] = [
  ['TypeScript', ['typescript', 'ts']],
  ['JavaScript', ['javascript', 'js']],
  ['Python', ['python']],
  ['Java', ['java']],
  ['Go', ['golang', 'go']],
  ['C++', ['c++']],
  ['Rust', ['rust']],
  ['React', ['react', 'react.js']],
  ['Vue', ['vue', 'vue.js']],
  ['Node.js', ['node.js', 'nodejs']],
  ['Spring', ['spring', 'spring boot', 'springboot']],
  ['FastAPI', ['fastapi']],
  ['SQL', ['sql']],
  ['MySQL', ['mysql']],
  ['PostgreSQL', ['postgresql', 'postgres']],
  ['Redis', ['redis']],
  ['Kafka', ['kafka']],
  ['Docker', ['docker']],
  ['Kubernetes', ['kubernetes', 'k8s']],
  ['Linux', ['linux']],
  ['Git', ['git', 'github', 'gitlab']],
  ['AWS', ['aws', 'amazon web services']],
  ['RAG', ['rag', 'retrieval augmented generation', '检索增强生成']],
  ['LLM', ['llm', '大语言模型', '语言模型']],
  ['Agent', ['agent', '智能体']],
  ['PyTorch', ['pytorch']],
  ['TensorFlow', ['tensorflow']],
  ['Flink', ['flink']],
  ['Spark', ['spark']],
]

const CITY_TERMS: readonly string[] = [
  '北京', '上海', '广州', '深圳', '杭州', '南京', '苏州', '成都', '武汉', '西安', '重庆', '天津',
  '宁波', '厦门', '福州', '合肥', '郑州', '长沙', '青岛', '济南', '大连', '无锡', '东莞', '珠海',
]

function extractTechnologies(text: string): string[] {
  return SKILL_ALIASES
    .filter(([, aliases]) => aliases.some((alias) => containsTerm(text, alias)))
    .map(([name]) => name)
}

const CAPABILITY_RULES: readonly [ResumeCapabilityLabel, readonly RegExp[]][] = [
  ['Backend Engineering', [/后端/u, /服务端/u, /微服务/u, /\bbff\b/iu, /\bbackend\b/iu]],
  ['Full-stack Delivery', [/全栈/u, /前后端(?:完整)?(?:链路|开发|交付)/u, /端到端(?:研发|开发|交付)/u, /\bfull[ -]?stack\b/iu]],
  ['Frontend Engineering', [/前端/u, /\bssr\b/iu, /server[ -]?side rendering/iu, /\bfrontend\b/iu]],
  ['AI Application', [/ai\s*应用/iu, /大模型应用/u, /智能体应用/u, /agent(?:ic)?\s*(?:application|应用)/iu]],
  ['API Integration', [/api\s*编排/iu, /接口编排/u, /接口集成/u, /api\s*integration/iu, /api\s*orchestration/iu, /restful\s*(?:api)?/iu, /api\s*(?:开发|接入)/iu]],
  ['Performance Optimization', [/性能(?:调优|优化)/u, /慢\s*sql/iu, /缓存优化/u, /性能压测/u, /performance\s*(?:tuning|optimization)/iu]],
  ['Test Automation', [/自动化测试/u, /单元测试/u, /集成测试/u, /测试框架/u, /test\s*automation/iu]],
  ['CI/CD', [/ci\s*\/\s*cd/iu, /持续集成/u, /持续交付/u, /持续部署/u, /构建流水线/u]],
  ['Cloud/DevOps', [/云原生/u, /devops/iu, /容器化/u, /基础设施即代码/u]],
  ['Data Engineering', [/数据工程/u, /数据研发/u, /数据管道/u, /数据处理/u, /\betl\b/iu, /\bhive\b/iu]],
]

function extractCapabilities(
  text: string,
  technologies: readonly string[],
  inferFromTechnologies: boolean,
): ResumeCapabilityLabel[] {
  const observed = new Set<ResumeCapabilityLabel>()
  for (const [label, patterns] of CAPABILITY_RULES) {
    if (patterns.some((pattern) => pattern.test(text))) observed.add(label)
  }
  if (inferFromTechnologies) {
    const hasBackendTechnology = technologies.some((technology) => ['Java', 'Spring', 'Node.js', 'FastAPI', 'Python', 'Go', 'C++', 'Rust'].includes(technology))
    const hasFrontendTechnology = technologies.some((technology) => ['React', 'Vue', 'TypeScript', 'JavaScript'].includes(technology))
    if (hasBackendTechnology) observed.add('Backend Engineering')
    if (hasFrontendTechnology) observed.add('Frontend Engineering')
    if (hasBackendTechnology && hasFrontendTechnology) observed.add('Full-stack Delivery')
    if (technologies.some((technology) => ['Agent', 'RAG', 'LLM'].includes(technology))) observed.add('AI Application')
    if (technologies.some((technology) => ['Docker', 'Kubernetes', 'AWS'].includes(technology))) observed.add('Cloud/DevOps')
    if (technologies.some((technology) => ['Flink', 'Spark'].includes(technology))) observed.add('Data Engineering')
  }
  return CAPABILITY_RULES.map(([label]) => label).filter((label) => observed.has(label))
}

function summarizeResume(
  rawText: string,
  normalizedText: string,
  technologies: readonly string[],
  capabilities: readonly ResumeCapabilityLabel[],
): ResumeSummary {
  const education = highestEducation(normalizedText)
  const projects = projectBlocks(rawText)
  const directionCounts = new Map<ResumeCapabilityLabel, number>()
  for (const project of projects) {
    const normalizedProject = normalizeText(project)
    const projectTechnologies = extractTechnologies(normalizedProject)
    for (const capability of extractCapabilities(normalizedProject, projectTechnologies, true)) {
      directionCounts.set(capability, (directionCounts.get(capability) ?? 0) + 1)
    }
  }
  return {
    education: education === undefined
      ? { status: 'not_observed' }
      : { highestLevel: education, status: 'observed' },
    cohorts: uniqueYearMatches(normalizedText),
    locations: CITY_TERMS.filter((city) => normalizedText.includes(city)),
    technologies,
    capabilities,
    projects: {
      total: projects.length,
      directions: CAPABILITY_RULES
        .map(([label]) => ({ label, count: directionCounts.get(label) ?? 0 }))
        .filter((item) => item.count > 0),
      detection: projects.length > 0 ? 'section_blocks' : 'not_observed',
    },
  }
}

function projectBlocks(rawText: string): string[] {
  const lines = rawText
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const sectionStart = lines.findIndex((line) => /^(?:项目经历|项目经验|projects?)\s*[:：]?$/iu.test(line))
  if (sectionStart < 0) return []
  const sectionEndOffset = lines
    .slice(sectionStart + 1)
    .findIndex((line) => /^(?:教育经历|教育背景|工作经历|实习经历|专业技能|技能清单|自我评价|个人总结|证书|获奖经历)\s*[:：]?$/u.test(line))
  const sectionEnd = sectionEndOffset < 0 ? lines.length : sectionStart + 1 + sectionEndOffset
  const blocks: string[][] = []
  let current: string[] | undefined
  for (const line of lines.slice(sectionStart + 1, sectionEnd)) {
    if (isProjectStart(line)) {
      if (current !== undefined) blocks.push(current)
      current = [line]
    } else if (current !== undefined) {
      current.push(line)
    }
  }
  if (current !== undefined) blocks.push(current)
  return blocks.map((block) => block.join('\n'))
}

function isProjectStart(line: string): boolean {
  return /^(?:项目\s*[一二三四五六七八九十0-9]+|project\s*#?\s*\d+)\s*(?:[:：|｜-]|$)/iu.test(line)
    || /^(?:20\d{2}[./年-]\d{1,2}).{0,40}(?:至今|20\d{2}[./年-]\d{1,2})/u.test(line)
}

function highestEducation(text: string): ResumeSummary['education']['highestLevel'] | undefined {
  const terms: readonly [ResumeSummary['education']['highestLevel'], readonly string[]][] = [
    ['博士', ['博士', 'phd']],
    ['硕士', ['硕士', 'master']],
    ['本科', ['本科', 'bachelor']],
    ['大专', ['大专']],
  ]
  return terms.find(([, aliases]) => aliases.some((alias) => containsTerm(text, alias)))?.[0]
}

function extractHardConstraints(jd: string, resume: string): ResumeMatchConstraint[] {
  const constraints: ResumeMatchConstraint[] = []
  const education = educationRequirement(jd)
  if (education !== undefined) {
    const observed = firstMatching(resume, ['博士', '硕士', '本科', '大专', 'phd', 'master', 'bachelor'])
    constraints.push({
      field: 'education',
      constraintType: 'eligibility',
      status: observed === undefined ? 'unknown' : educationCompatible(education, observed) ? 'matched' : 'unmatched',
      required: education,
      ...observed === undefined ? {} : { observed },
    })
  }
  const jdYears = uniqueYearMatches(jd)
  if (jdYears.length > 0) {
    const resumeYears = uniqueYearMatches(resume)
    constraints.push({
      field: 'cohort',
      constraintType: 'eligibility',
      status: resumeYears.length === 0 ? 'unknown' : resumeYears.some((year) => jdYears.includes(year)) ? 'matched' : 'unmatched',
      required: jdYears.join(', '),
      ...resumeYears.length === 0 ? {} : { observed: resumeYears.join(', ') },
    })
  }
  const jdCities = CITY_TERMS.filter((city) => jd.includes(city))
  if (jdCities.length > 0) {
    const resumeCities = CITY_TERMS.filter((city) => resume.includes(city))
    const matchedCity = resumeCities.find((city) => jdCities.includes(city))
    constraints.push({
      field: 'location',
      constraintType: 'preference',
      status: resumeCities.length === 0 ? 'unknown' : matchedCity === undefined ? 'unmatched' : 'matched',
      required: jdCities.join(', '),
      ...resumeCities.length === 0 ? {} : { observed: resumeCities.join(', ') },
      requiresUserConfirmation: true,
    })
  }
  const jdRequirement = parseExperience(jd)
  if (jdRequirement !== undefined) {
    const observed = parseExperience(resume)
    const required = jdRequirement.maximum === undefined
      ? `${jdRequirement.minimum}年`
      : `${jdRequirement.minimum}-${jdRequirement.maximum}年`
    constraints.push({
      field: 'experience',
      constraintType: 'eligibility',
      status: observed === undefined
        ? 'unknown'
        : observed.minimum >= jdRequirement.minimum ? 'matched' : 'unmatched',
      required,
      ...observed === undefined ? {} : { observed: `${observed.minimum}年` },
    })
  }
  return constraints
}

// BOSS obfuscates copied text with characters such as U+2011, so fold the
// dash-like code points onto ASCII before scanning a numeric range.
const EXPERIENCE_DASHES = /[\u2010\u2011\u2012\u2013\u2014\u2212\uff0d]/gu
// Bounds stop a date range ("2023-2024年") from reading as a tenure.
const MAX_PLAUSIBLE_YEARS = 60

/**
 * Parse an experience requirement, or a stated tenure.
 *
 * Covers the range form BOSS uses most ("1-3 年"), the minimum form
 * ("3年以上" / "2年及以上"), an explicit label ("工作年限：1") and a tenure
 * phrase whose "经验" is separated from the number ("1 年 AI 应用开发经验").
 * The range's upper bound records the employer's stated window but never
 * gates eligibility: over-qualification must not be scored as ineligible.
 */
function parseExperience(text: string): { minimum: number; maximum?: number } | undefined {
  const normalized = text.replace(EXPERIENCE_DASHES, '-')
  const range = normalized.match(/(\d+)\s*[-~～至到]\s*(\d+)\s*年/u)
  if (range?.[1] !== undefined && range[2] !== undefined) {
    const minimum = Number(range[1])
    const maximum = Number(range[2])
    if (minimum <= maximum && maximum <= MAX_PLAUSIBLE_YEARS) return { minimum, maximum }
  }
  const labelled = normalized.match(/(?:工作年限|工作经验|经验要求)\s*[:：]?\s*(\d+)/u)
  if (labelled?.[1] !== undefined) return { minimum: Number(labelled[1]) }
  const atLeast = normalized.match(/(\d+)\s*年\s*(?:及)?以上/u)
  if (atLeast?.[1] !== undefined) return { minimum: Number(atLeast[1]) }
  const tenure = normalized.match(/(\d+)\s*年[\s\S]{0,16}?经验/u)
  if (tenure?.[1] !== undefined) return { minimum: Number(tenure[1]) }
  return undefined
}

interface ScoreMatchInput {
  readonly requiredTechnologies: readonly string[]
  readonly matchedTechnologies: readonly string[]
  readonly requiredCapabilities: readonly ResumeCapabilityLabel[]
  readonly matchedCapabilities: readonly ResumeCapabilityLabel[]
  readonly constraints: readonly ResumeMatchConstraint[]
  readonly scoring: ResumeMatchScoringOptions
}

/**
 * Weighted skill coverage plus the averaged constraint score.
 *
 * Weighting stops a long keyword list from diluting the denominator: a
 * capability or a target-direction technology counts for more than an
 * incidental mention. Only constraints selected by the scoring options are
 * scored, so a location preference informs the result without costing points.
 */
function scoreMatch(input: ScoreMatchInput): number {
  const { scoring } = input
  const requiredWeight = weightedTotal(input.requiredTechnologies, 'technology', scoring)
    + weightedTotal(input.requiredCapabilities, 'capability', scoring)
  if (requiredWeight === 0 && input.constraints.length === 0) return 0
  const matchedWeight = weightedTotal(input.matchedTechnologies, 'technology', scoring)
    + weightedTotal(input.matchedCapabilities, 'capability', scoring)
  const skillScore = requiredWeight === 0
    ? scoring.noRequiredSkillScore
    : (matchedWeight / requiredWeight) * scoring.skillWeightTotal
  const scored = input.constraints.filter(
    (constraint) => scoring.preferenceConstraintsAffectScore || constraint.constraintType !== 'preference',
  )
  const constraintScore = scored.length === 0
    ? scoring.noScoredConstraintScore
    : scored.reduce((total, constraint) => total + (
        constraint.status === 'matched'
          ? scoring.matchedConstraintScore
          : constraint.status === 'unknown' ? scoring.unknownConstraintScore : scoring.unmatchedConstraintScore
      ), 0) / scored.length
  return Math.max(0, Math.min(100, Math.round(skillScore + constraintScore + scoring.baseScore)))
}

function weightedTotal(
  labels: readonly string[],
  kind: 'technology' | 'capability',
  scoring: ResumeMatchScoringOptions,
): number {
  return labels.reduce((total, label) => total + requiredItemWeight(label, kind, scoring), 0)
}

function calibratedScore(
  rawScore: number,
  extractionStatus: ResumeTextContent['extractionStatus'],
  constraints: readonly ResumeMatchConstraint[],
  requiredSkillCount: number,
  matchedSkillCount: number,
  scoring: ResumeMatchScoringOptions,
): number {
  const eligibilityConstraints = constraints.filter((constraint) => constraint.constraintType === 'eligibility')
  if (extractionStatus === 'text_truncated') return Math.min(rawScore, scoring.truncatedScoreCap)
  if (eligibilityConstraints.some((constraint) => constraint.status === 'unmatched')) {
    return Math.min(rawScore, scoring.unmatchedScoreCap)
  }
  if (eligibilityConstraints.some((constraint) => constraint.status === 'unknown')) {
    return Math.min(rawScore, scoring.unknownScoreCap)
  }
  // A JD that yields barely any requirement terms cannot support a confident
  // score: without this the weighted ratio reads as a near-perfect match.
  if (requiredSkillCount > 0 && requiredSkillCount < scoring.minRequiredSkillsForFullCredit) {
    return Math.min(rawScore, scoring.thinJdScoreCap)
  }
  // Weighting a core skill heavily must not let a single confirmed term stand in
  // for a confident verdict.
  if (matchedSkillCount < scoring.minMatchedSkillsForStrong) {
    return Math.min(rawScore, scoring.matchedEvidenceScoreCap)
  }
  return rawScore
}

function levelFor(
  score: number,
  extractionStatus: ResumeTextContent['extractionStatus'],
  requiredSkillCount: number,
  constraints: readonly ResumeMatchConstraint[],
  scoring: ResumeMatchScoringOptions,
): ResumeMatchLevel {
  const eligibilityConstraints = constraints.filter((constraint) => constraint.constraintType === 'eligibility')
  if (extractionStatus === 'text_truncated' || (requiredSkillCount === 0 && constraints.length === 0)) {
    return 'insufficient_evidence'
  }
  if (eligibilityConstraints.some((constraint) => constraint.status === 'unmatched')) {
    return score >= scoring.weakScore ? 'weak' : 'insufficient_evidence'
  }
  if (eligibilityConstraints.some((constraint) => constraint.status === 'unknown') && score >= scoring.moderateScore) {
    return 'moderate'
  }
  if (score >= scoring.strongScore) return 'strong'
  if (score >= scoring.moderateScore) return 'moderate'
  if (score >= scoring.weakScore) return 'weak'
  return 'insufficient_evidence'
}

/**
 * Turn every unanswered eligibility requirement into a question.
 *
 * A missing evidence field used to only lower the score. Asking is the honest
 * outcome: the candidate can answer it, the matcher cannot infer it.
 */
function buildClarifications(constraints: readonly ResumeMatchConstraint[]): ResumeMatchClarification[] {
  return constraints
    .filter((constraint) => constraint.constraintType === 'eligibility' && constraint.status === 'unknown')
    .map((constraint) => ({
      field: constraint.field,
      constraintType: constraint.constraintType,
      ...(constraint.required === undefined ? {} : { required: constraint.required }),
      question: clarificationQuestion(constraint),
    }))
}

function clarificationQuestion(constraint: ResumeMatchConstraint): string {
  const required = constraint.required === undefined ? '' : `（要求：${constraint.required}）`
  switch (constraint.field) {
    case 'education':
      return `未能从简历确认你的最高学历${required}，请确认你的最高学历。`
    case 'experience':
      return `未能从简历确认你的相关工作年限${required}，请确认你的实际工作年限。`
    case 'cohort':
      return `未能从简历确认你的毕业届别${required}，请确认你的毕业年份或届别。`
    case 'location':
      return `未能从简历确认你的所在城市${required}，请确认你期望的工作城市。`
  }
}

function educationRequirement(text: string): string | undefined {
  const explicitMinimums: readonly [string, RegExp][] = [
    ['大专', /大专(?:及以上|以上)/u],
    ['本科', /本科(?:及以上|以上)/u],
    ['硕士', /硕士(?:及以上|以上)/u],
    ['博士', /博士(?:及以上|以上)/u],
    ['bachelor', /bachelor(?:'?s)?(?: degree)?\s*(?:or above|or higher|and above|\+)/iu],
    ['master', /master(?:'?s)?(?: degree)?\s*(?:or above|or higher|and above|\+)/iu],
    ['phd', /ph\.?d\.?(?: degree)?\s*(?:or above|or higher|and above|\+)?/iu],
  ]
  const explicit = explicitMinimums.find(([, pattern]) => pattern.test(text))
  if (explicit !== undefined) return explicit[0]

  return firstMatchingByPosition(text, ['博士', '硕士', '本科', '大专', 'phd', 'master', 'bachelor'])
}

function educationCompatible(required: string, observed: string): boolean {
  const rank = (value: string): number => value.includes('博士') || value.includes('phd') ? 4 : value.includes('硕士') || value.includes('master') ? 3 : value.includes('本科') || value.includes('bachelor') ? 2 : 1
  return rank(observed) >= rank(required)
}

function firstMatching(text: string, terms: readonly string[]): string | undefined {
  return terms.find((term) => containsTerm(text, term))
}

function firstMatchingByPosition(text: string, terms: readonly string[]): string | undefined {
  return terms
    .map((term) => ({ term, index: text.indexOf(term) }))
    .filter((candidate) => candidate.index >= 0 && containsTerm(text, candidate.term))
    .sort((left, right) => left.index - right.index)[0]?.term
}

function uniqueYearMatches(text: string): string[] {
  return [...new Set([...text.matchAll(/(20\d{2})\s*(?:届|校招|毕业)/gu)].map((match) => match[1]).filter((year): year is string => year !== undefined))]
}

function containsSkill(text: string, skill: string): boolean {
  const aliases = SKILL_ALIASES.find(([name]) => name === skill)?.[1] ?? [skill]
  return aliases.some((alias) => containsTerm(text, alias))
}

function containsTerm(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const asciiWord = /^[a-z0-9+.# -]+$/u.test(term)
  return asciiWord
    ? new RegExp(`(?<![a-z0-9.])${escaped}(?![a-z0-9.])`, 'iu').test(text)
    : text.includes(term)
}

function normalizeText(value: string): string {
  return value.toLocaleLowerCase('zh-CN').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim()
}

function requireText(value: string, name: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) throw new Error(`invalid_${name}`)
  return normalized
}
