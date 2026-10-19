import type { ReactNode } from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * The harness renamed the numeric Outline icons to semantic size names
 * (`IconCloseOutline16` became `IconCloseOutlineMedium`).
 *
 * CI pins an older harness that only exports the numeric names, while a current
 * local checkout only exports the semantic ones. Resolving the name at runtime
 * lets one client bundle load against both generations instead of hard-coding
 * either. A missing glyph is cosmetic, so the fallback keeps the panel usable.
 */
export type HarnessIcon = (props: { readonly size?: number }) => ReactNode

const icons = primitives as unknown as Record<string, HarnessIcon | undefined>
const warned = new Set<string>()

function resolveIcon(candidates: readonly string[]): HarnessIcon {
  for (const name of candidates) {
    const icon = icons[name]
    if (typeof icon === 'function') return icon
  }
  const label = candidates.join(' | ')
  if (!warned.has(label)) {
    warned.add(label)
    console.warn(`[boss-watch] no harness icon exported for: ${label}`)
  }
  return () => null
}

export const IconData = resolveIcon(['IconDataOutlineMedium', 'IconDataOutline16', 'IconDataOutline14'])
export const IconClose = resolveIcon(['IconCloseOutlineMedium', 'IconCloseOutline16', 'IconCloseOutline14'])
export const IconLink = resolveIcon(['IconLinkOutlineMedium', 'IconLinkOutline16', 'IconLinkOutline14'])
export const IconPlus = resolveIcon(['IconPlusOutlineMedium', 'IconPlusOutline16', 'IconPlusOutline14'])
export const IconPaperclip = resolveIcon([
  'IconPaperclipOutlineMedium',
  'IconPaperclipOutline16',
  'IconPaperclipOutline14',
])
