import type { ReviewItemRow } from '../../../shared/wiki-state'
import type { ReviewQueueSummaryViewModel } from '../../selectors/wikiStateViewModels'

export function ReviewQueuePanel({
  summary,
  reviewItems = [],
  onResolveReview,
  actionsDisabled = false,
}: {
  summary: ReviewQueueSummaryViewModel
  reviewItems?: ReviewItemRow[]
  onResolveReview?: (
    reviewItemId: string,
    resolution: `approve` | `reject`
  ) => void
  actionsDisabled?: boolean
}) {
  const openItems = reviewItems.filter((item) => item.status === `open`)

  return (
    <section
      className="lw-card"
      style={{ padding: 20 }}
      aria-labelledby="review-queue-heading"
    >
      <h2 id="review-queue-heading">Review queue</h2>
      {summary.total === 0 ? (
        <p>No review items yet. Curator decisions will appear here.</p>
      ) : (
        <>
          <p>
            <strong>{summary.open} open</strong> · {summary.approved} approved ·
            {` `}
            {summary.rejected} rejected
          </p>
          {openItems.length > 0 ? (
            <ul>
              {openItems.map((item) => (
                <li key={item.id}>
                  <strong>{item.suggested_change}</strong>
                  {` `}
                  <button
                    type="button"
                    disabled={actionsDisabled}
                    onClick={() => onResolveReview?.(item.id, `approve`)}
                  >
                    Approve
                  </button>
                  {` `}
                  <button
                    type="button"
                    disabled={actionsDisabled}
                    onClick={() => onResolveReview?.(item.id, `reject`)}
                  >
                    Reject
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  )
}
