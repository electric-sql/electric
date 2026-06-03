import type {
  ActivityEventRow,
  ReviewItemRow,
} from '../../../shared/wiki-state'
import type {
  MemberCardViewModel,
  ReviewQueueSummaryViewModel,
  SourcesByStatusViewModel,
  WikiGraphSummaryViewModel,
  WikiPageCardViewModel,
} from '../../selectors/wikiStateViewModels'
import { ActivityFeed } from './ActivityFeed'
import { MembersPanel } from './MembersPanel'
import { ReviewQueuePanel } from './ReviewQueuePanel'
import { SourcesPanel } from './SourcesPanel'
import { WikiPagesPanel } from './WikiPagesPanel'

export type WikiStateDashboardViewModel = {
  activityEvents: ActivityEventRow[]
  members: MemberCardViewModel[]
  sources: SourcesByStatusViewModel
  graphSummary: WikiGraphSummaryViewModel
  pageCards: WikiPageCardViewModel[]
  reviewSummary: ReviewQueueSummaryViewModel
  reviewItems?: ReviewItemRow[]
}

const queueRows = [
  [`Page Approvals`, `open`],
  [`Outline Reviews`, `approved`],
  [`Merge Decisions`, `rejected`],
  [`Link Proposals`, `links`],
  [`Contradiction Flags`, `flags`],
] as const

export function WikiStateDashboard({
  viewModel,
  onProposePage,
  onResolveReview,
  actionsDisabled = false,
}: {
  viewModel: WikiStateDashboardViewModel
  onProposePage?: (sourceId: string) => void
  onResolveReview?: (
    reviewItemId: string,
    resolution: `approve` | `reject`
  ) => void
  actionsDisabled?: boolean
}) {
  const pageCards = viewModel.pageCards ?? []
  const openReview = viewModel.reviewItems?.find(
    (item) => item.status === `open`
  )
  const selectedPage =
    pageCards.find((page) => page.status === `proposed`) ?? pageCards[0]
  const submittedSources = viewModel.sources.submitted
  const selectedSource = submittedSources[0]
  const graphNodes = Math.max(
    viewModel.graphSummary.totalPages,
    pageCards.length,
    selectedSource ? 4 : 3
  )

  return (
    <section
      className="lw-wiki-layout"
      aria-label="Living wiki shared-state dashboard"
    >
      <aside
        className="lw-left-rail"
        aria-label="Review queues and work surfaces"
      >
        <div className="lw-panel-label">LEFT RAIL</div>
        <h2>Queues</h2>
        <dl className="lw-queue-list">
          {queueRows.map(([label, key]) => (
            <div key={label} className="lw-queue-row">
              <dt>{label}</dt>
              <dd>
                {key === `open`
                  ? viewModel.reviewSummary.open
                  : key === `approved`
                    ? viewModel.reviewSummary.approved
                    : key === `rejected`
                      ? viewModel.reviewSummary.rejected
                      : key === `links`
                        ? viewModel.graphSummary.totalLinks
                        : 0}
              </dd>
            </div>
          ))}
        </dl>

        <section className="lw-selected-queue" aria-label="Selected queue item">
          <div className="lw-divider-title">Selected Queue Item</div>
          <h3>
            {openReview?.suggested_change ??
              selectedPage?.title ??
              selectedSource?.title ??
              `WikiAgent: Protocol Stigmergy`}
          </h3>
          <p>
            Status:{` `}
            <strong>
              {openReview?.status ?? selectedPage?.status ?? `proposed`}
            </strong>
          </p>
          <p>Sources: {submittedSources.length}</p>
          <p>Similar pages: {Math.max(pageCards.length - 1, 0)}</p>
          <button type="button">Ask WikiAgent</button>
          {openReview ? (
            <div className="lw-action-row">
              <button
                type="button"
                disabled={actionsDisabled}
                onClick={() => onResolveReview?.(openReview.id, `approve`)}
              >
                Approve
              </button>
              <button
                type="button"
                disabled={actionsDisabled}
                onClick={() => onResolveReview?.(openReview.id, `reject`)}
              >
                Reject
              </button>
              <button type="button" disabled>
                Merge…
              </button>
            </div>
          ) : (
            <div className="lw-action-row">
              <button type="button" disabled>
                Approve
              </button>
              <button type="button" disabled>
                Reject
              </button>
              <button type="button" disabled>
                Merge…
              </button>
            </div>
          )}
        </section>

        <section className="lw-agent-chat" aria-label="Agent chat">
          <div className="lw-divider-title">Agent Chat</div>
          <p>
            <strong>You:</strong> why page?
          </p>
          <p>
            <strong>Agent:</strong> It connects source notes into durable
            compiled knowledge and asks for human review.
          </p>
        </section>
      </aside>

      <main className="lw-center-surface" aria-label="Living wiki graph">
        <div className="lw-panel-label">CENTER: LIVING WIKI / GRAPH</div>
        <div className="lw-legend">
          <span>faint = proposed page</span>
          <span>solid = approved article</span>
          <span>dashed = pending edge</span>
        </div>
        <p className="lw-graph-summary">
          {viewModel.graphSummary.totalPages === 0
            ? `The graph is waiting for proposed pages and links.`
            : `${viewModel.graphSummary.totalPages} total pages · ${viewModel.graphSummary.pages.canonical} canonical · ${viewModel.graphSummary.pages.proposed} proposed · ${viewModel.graphSummary.totalLinks} links`}
        </p>
        <div
          className="lw-graph-map"
          aria-label={`${graphNodes} wiki graph nodes`}
        >
          <div className="lw-node lw-node-solid lw-node-compiled">
            ○ Compiled Knowledge
          </div>
          <div className="lw-edge lw-edge-a" />
          <div className="lw-node lw-node-faint lw-node-llm">○ LLM Wiki</div>
          <div className="lw-edge lw-edge-b" />
          <div className="lw-node lw-node-solid lw-node-rag">○ RAG</div>
          <div className="lw-edge lw-edge-c" />
          <div className="lw-node lw-node-solid lw-node-protocol">
            ○ Protocol Communities
          </div>
          <div className="lw-edge lw-edge-d" />
          <div className="lw-node lw-node-faint lw-node-culture">
            ○ Culture-World-Machines
          </div>
          <div className="lw-tooltip-card">
            <strong>Edge: LLM Wiki ↔ Protocol Stigmergy</strong>
            <span>Proposed by: TopicCuratorAgent</span>
            <span>Reason: shared source lineage + claims</span>
            <span>Status: pending approval</span>
          </div>
        </div>

        <div className="lw-center-panels">
          <SourcesPanel
            sources={viewModel.sources}
            onProposePage={onProposePage}
            actionsDisabled={actionsDisabled}
          />
          <WikiPagesPanel pages={pageCards} />
        </div>
      </main>

      <aside className="lw-right-pulse" aria-label="Right pulse">
        <div className="lw-panel-label">RIGHT PULSE</div>
        <section className="lw-pulse-section" aria-label="Global chat">
          <h2>Global Chat</h2>
          <p>Maya: I added a source on RFCs</p>
          <p>Agent-7: try comparing it to Karpathy</p>
        </section>
        <ActivityFeed events={viewModel.activityEvents} />
        <MembersPanel members={viewModel.members} />
        <ReviewQueuePanel
          summary={viewModel.reviewSummary}
          reviewItems={viewModel.reviewItems}
          onResolveReview={onResolveReview}
          actionsDisabled={actionsDisabled}
        />
      </aside>
    </section>
  )
}
