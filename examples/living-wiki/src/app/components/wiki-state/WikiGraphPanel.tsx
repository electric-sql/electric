import type { WikiGraphSummaryViewModel } from '../../selectors/wikiStateViewModels'

export function WikiGraphPanel({
  summary,
}: {
  summary: WikiGraphSummaryViewModel
}) {
  const empty = summary.totalPages === 0 && summary.totalLinks === 0
  return (
    <section
      className="lw-card"
      style={{ padding: 20 }}
      aria-labelledby="wiki-graph-heading"
    >
      <h2 id="wiki-graph-heading">Wiki graph</h2>
      {empty ? (
        <p>The graph is waiting for proposed pages and links.</p>
      ) : (
        <dl>
          <dt>Pages</dt>
          <dd>
            {summary.totalPages} total · {summary.pages.canonical} canonical ·{' '}
            {summary.pages.proposed} proposed · {summary.pages.rejected}{' '}
            rejected
          </dd>
          <dt>Links</dt>
          <dd>
            {summary.totalLinks} total · {summary.links.canonical} canonical ·{' '}
            {summary.links.proposed} proposed · {summary.links.rejected}{' '}
            rejected
          </dd>
        </dl>
      )}
    </section>
  )
}
