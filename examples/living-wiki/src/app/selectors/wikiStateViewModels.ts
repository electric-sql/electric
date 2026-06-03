import type {
  ActivityEventRow,
  ActorRow,
  MembershipRow,
  ReviewItemRow,
  SourceRow,
  WikiLinkRow,
  WikiPageRow,
} from '../../shared/wiki-state'

export type MemberCardViewModel = {
  membershipId: string
  actorId: string
  displayName: string
  actorKind: ActorRow[`kind`] | `unknown`
  avatarColor: string
  role: MembershipRow[`role`]
  status: MembershipRow[`status`]
  joinedAt: string
  actorMissing: boolean
}

export type SourcesByStatusViewModel = Record<SourceRow[`status`], SourceRow[]>

export type StatusCounts = {
  proposed: number
  canonical: number
  rejected: number
  total: number
}

export type WikiGraphSummaryViewModel = {
  pages: StatusCounts
  links: StatusCounts
  totalPages: number
  totalLinks: number
}

export type WikiPageCardViewModel = {
  id: string
  title: string
  slug: string
  status: WikiPageRow[`status`]
  summary: string | null
  bodyPreview: string | null
  sourceCount: number
  createdAt: string
  updatedAt: string
}

export type ReviewQueueSummaryViewModel = {
  open: number
  approved: number
  rejected: number
  total: number
  hasOpenItems: boolean
}

export function selectRecentActivity(
  events: ActivityEventRow[]
): ActivityEventRow[] {
  return [...events].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
}

export function selectMemberCards(
  memberships: MembershipRow[],
  actors: ActorRow[]
): MemberCardViewModel[] {
  const actorsById = new Map(actors.map((actor) => [actor.id, actor]))

  return memberships.map((membership) => {
    const actor = actorsById.get(membership.actor_id)
    return {
      membershipId: membership.id,
      actorId: membership.actor_id,
      displayName: actor?.display_name ?? `Unknown actor`,
      actorKind: actor?.kind ?? `unknown`,
      avatarColor: actor?.avatar_color ?? `slate`,
      role: membership.role,
      status: membership.status,
      joinedAt: membership.joined_at,
      actorMissing: actor === undefined,
    }
  })
}

export function selectSourcesByStatus(
  sources: SourceRow[]
): SourcesByStatusViewModel {
  return {
    submitted: sources.filter((source) => source.status === `submitted`),
    published: sources.filter((source) => source.status === `published`),
    rejected: sources.filter((source) => source.status === `rejected`),
  }
}

function countGraphStatuses<
  T extends { status: `proposed` | `canonical` | `rejected` },
>(rows: T[]): StatusCounts {
  return {
    proposed: rows.filter((row) => row.status === `proposed`).length,
    canonical: rows.filter((row) => row.status === `canonical`).length,
    rejected: rows.filter((row) => row.status === `rejected`).length,
    total: rows.length,
  }
}

const pageStatusSortOrder: Record<WikiPageRow[`status`], number> = {
  canonical: 0,
  proposed: 1,
  rejected: 2,
}

function previewBody(body: string | null): string | null {
  if (body === null) return null
  const normalized = body.replace(/\s+/g, ` `).trim()
  if (normalized.length <= 220) return normalized
  return `${normalized.slice(0, 217)}…`
}

export function selectWikiPageCards(
  pages: WikiPageRow[]
): WikiPageCardViewModel[] {
  return [...pages]
    .sort((a, b) => {
      const statusComparison =
        pageStatusSortOrder[a.status] - pageStatusSortOrder[b.status]
      if (statusComparison !== 0) return statusComparison

      const titleComparison = a.title.localeCompare(b.title)
      if (titleComparison !== 0) return titleComparison

      return b.updated_at.localeCompare(a.updated_at)
    })
    .map((page) => ({
      id: page.id,
      title: page.title,
      slug: page.slug,
      status: page.status,
      summary: page.summary,
      bodyPreview: previewBody(page.body),
      sourceCount: page.source_ids.length,
      createdAt: page.created_at,
      updatedAt: page.updated_at,
    }))
}

export function selectWikiGraphSummary(
  pages: WikiPageRow[],
  links: WikiLinkRow[]
): WikiGraphSummaryViewModel {
  const pageCounts = countGraphStatuses(pages)
  const linkCounts = countGraphStatuses(links)
  return {
    pages: pageCounts,
    links: linkCounts,
    totalPages: pageCounts.total,
    totalLinks: linkCounts.total,
  }
}

export function selectReviewQueueSummary(
  items: ReviewItemRow[]
): ReviewQueueSummaryViewModel {
  const open = items.filter((item) => item.status === `open`).length
  const approved = items.filter((item) => item.status === `approved`).length
  const rejected = items.filter((item) => item.status === `rejected`).length
  return {
    open,
    approved,
    rejected,
    total: items.length,
    hasOpenItems: open > 0,
  }
}
