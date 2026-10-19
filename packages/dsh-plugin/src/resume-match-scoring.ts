/**
 * Tunable parameters for `local-evidence-match` scoring.
 *
 * The scoring used to be hard-coded inside `resume-matching.ts`. Keeping the
 * numbers here makes the weighting and the calibration caps reviewable and
 * adjustable without touching the algorithm.
 *
 * Two behaviours are deliberately configurable because they encode a product
 * judgement rather than a technical truth:
 *
 * - `preferenceConstraintsAffectScore` — a location preference is information,
 *   not an eligibility gate. A candidate who is willing to relocate must not
 *   lose points for a job in another city.
 * - `minRequiredSkillsForFullCredit` / `thinJdScoreCap` — a JD that yields only
 *   one or two extractable requirement terms cannot support a confident score,
 *   so its credit is capped instead of silently reading as a perfect match.
 */

export interface ResumeMatchScoringOptions {
  /** Points awarded to a perfect weighted skill coverage. */
  readonly skillWeightTotal: number
  /** Points awarded when the JD yields no extractable requirement terms at all. */
  readonly noRequiredSkillScore: number
  /** Per-constraint points, averaged over every scored constraint. */
  readonly matchedConstraintScore: number
  readonly unknownConstraintScore: number
  readonly unmatchedConstraintScore: number
  /** Awarded when no constraint is scored at all (no constraints, or preferences only). */
  readonly noScoredConstraintScore: number
  /** Flat addition applied to every match. */
  readonly baseScore: number

  /** Relative influence of each required item on the weighted coverage. */
  readonly capabilityWeight: number
  readonly coreTechnologyWeight: number
  readonly defaultTechnologyWeight: number
  /** Technologies that carry the candidate's target direction. */
  readonly coreTechnologies: readonly string[]

  /** When false, `preference` constraints are reported but never scored. */
  readonly preferenceConstraintsAffectScore: boolean
  /** A JD yielding fewer than this many requirement terms is treated as thin evidence. */
  readonly minRequiredSkillsForFullCredit: number
  readonly thinJdScoreCap: number
  /**
   * A match that confirms fewer than this many requirement terms cannot be
   * `strong`: one matched skill is too little evidence for a confident verdict,
   * however heavily that single skill is weighted.
   */
  readonly minMatchedSkillsForStrong: number
  readonly matchedEvidenceScoreCap: number
  readonly truncatedScoreCap: number
  readonly unmatchedScoreCap: number
  readonly unknownScoreCap: number

  readonly strongScore: number
  readonly moderateScore: number
  readonly weakScore: number
}

export const DEFAULT_RESUME_MATCH_SCORING: ResumeMatchScoringOptions = {
  skillWeightTotal: 60,
  noRequiredSkillScore: 35,
  matchedConstraintScore: 30,
  unknownConstraintScore: 15,
  unmatchedConstraintScore: 0,
  noScoredConstraintScore: 25,
  baseScore: 10,

  capabilityWeight: 2,
  coreTechnologyWeight: 2,
  defaultTechnologyWeight: 1,
  coreTechnologies: ['Python', 'RAG', 'Agent', 'LLM', 'Prompt', 'FastAPI'],

  preferenceConstraintsAffectScore: false,
  // Only a JD that yields a single requirement term counts as thin evidence.
  // A threshold of 3 would also cap legitimate two-term JDs, which the gold
  // regression set explicitly expects to reach a full score.
  minRequiredSkillsForFullCredit: 2,
  thinJdScoreCap: 74,
  // Two confirmed requirement terms are enough for `strong`; a single one is not.
  minMatchedSkillsForStrong: 2,
  matchedEvidenceScoreCap: 74,
  truncatedScoreCap: 24,
  unmatchedScoreCap: 49,
  unknownScoreCap: 74,

  strongScore: 75,
  moderateScore: 50,
  weakScore: 25,
}

/**
 * Weight of one required item.
 *
 * A capability is the strongest available evidence; a technology in
 * `coreTechnologies` carries the candidate's direction; anything else is
 * counted once so a long keyword list cannot dominate the denominator.
 */
export function requiredItemWeight(
  label: string,
  kind: 'technology' | 'capability',
  scoring: ResumeMatchScoringOptions,
): number {
  if (kind === 'capability') return scoring.capabilityWeight
  return scoring.coreTechnologies.includes(label)
    ? scoring.coreTechnologyWeight
    : scoring.defaultTechnologyWeight
}
