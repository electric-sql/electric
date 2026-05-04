import type { ElectricEntity } from './ElectricAgentsProvider'

const NOISE_TAGS = new Set([`swarm_id`, `source`, `parent`])
const SPAWN_ARG_TITLE_KEYS = [
  `prompt`,
  `task`,
  `topic`,
  `corpus`,
  `description`,
  `message`,
  `title`,
  `cwd`,
]

/**
 * Pick a human-readable title for an entity, in this order of preference:
 *
 *   1. `tags.title` if non-empty
 *   2. The first non-noise tag value
 *   3. The first matching spawn-arg key (`prompt`, `task`, `topic`, …)
 *   4. The slug at the end of the URL (fallback)
 *
 * `isFromSlug` lets callers decide whether to also surface the slug in
 * the UI (e.g. as a secondary label) — only useful when the title was
 * derived from something more meaningful than the slug itself.
 */
export function getEntityDisplayTitle(entity: ElectricEntity): {
  title: string
  isFromSlug: boolean
} {
  const slug = entity.url.split(`/`).pop() ?? entity.url
  const tagTitle = entity.tags.title
  if (typeof tagTitle === `string` && tagTitle.length > 0) {
    return { title: tagTitle, isFromSlug: false }
  }
  for (const [key, value] of Object.entries(entity.tags)) {
    if (NOISE_TAGS.has(key)) continue
    if (typeof value === `string` && value.length > 0) {
      return { title: value, isFromSlug: false }
    }
  }
  for (const key of SPAWN_ARG_TITLE_KEYS) {
    const v = entity.spawn_args[key]
    if (typeof v === `string` && v.length > 0) {
      return { title: v.slice(0, 80), isFromSlug: false }
    }
  }
  return { title: slug, isFromSlug: true }
}
