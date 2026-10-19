import * as dshLlm from '@deepseek-ai/dsh-llm'

/**
 * The harness renamed the tool-call brand from `CallId` to `ToolCallId`.
 *
 * CI pins a harness revision that only exports `CallId`, while a current local
 * checkout only exports `ToolCallId`. Resolve whichever constructor the
 * installed harness provides so these tests run against both generations
 * instead of hard-coding either one.
 *
 * Both constructors are runtime identity functions (`value as Branded<...>`), so
 * substituting one for the other cannot change observable behaviour.
 */
const brands = dshLlm as unknown as Record<string, ((id: string) => string) | undefined>
const resolved = brands.ToolCallId ?? brands.CallId
if (resolved === undefined) {
  throw new Error('dsh_llm_tool_call_brand_missing: expected ToolCallId or CallId')
}

export const CallId = resolved
