import type { ActivityEventRow } from '../../../shared/wiki-state'
import type {
  MemberCardViewModel,
  ReviewQueueSummaryViewModel,
  SourcesByStatusViewModel,
  WikiGraphSummaryViewModel,
} from '../../selectors/wikiStateViewModels'
import { ActivityFeed } from './ActivityFeed'
import { MembersPanel } from './MembersPanel'
import { ReviewQueuePanel } from './ReviewQueuePanel'
import { SourcesPanel } from './SourcesPanel'
import { WikiGraphPanel } from './WikiGraphPanel'

export type WikiStateDashboardViewModel = {
  activityEvents: ActivityEventRow[]
  members: MemberCardViewModel[]
  sources: SourcesByStatusViewModel
  graphSummary: WikiGraphSummaryViewModel
  reviewSummary: ReviewQueueSummaryViewModel
}

export function WikiStateDashboard({
  viewModel,
}: {
  viewModel: WikiStateDashboardViewModel
}) {
  return (
    <section
      aria-label="Living wiki shared-state dashboard"
      style={{ display: `grid`, gap: 16, marginTop: 24 }}
    >
      <ActivityFeed events={viewModel.activityEvents} />
      <MembersPanel members={viewModel.members} />
      <SourcesPanel sources={viewModel.sources} />
      <WikiGraphPanel summary={viewModel.graphSummary} />
      <ReviewQueuePanel summary={viewModel.reviewSummary} />
    </section>
  )
}
