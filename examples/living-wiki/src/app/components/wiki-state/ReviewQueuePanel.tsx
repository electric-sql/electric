import type { ReviewQueueSummaryViewModel } from '../../selectors/wikiStateViewModels'

export function ReviewQueuePanel({
  summary,
}: {
  summary: ReviewQueueSummaryViewModel
}) {
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
        <p>
          <strong>{summary.open} open</strong> · {summary.approved} approved ·{' '}
          {summary.rejected} rejected
        </p>
      )}
    </section>
  )
}
