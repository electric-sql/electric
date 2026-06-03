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
