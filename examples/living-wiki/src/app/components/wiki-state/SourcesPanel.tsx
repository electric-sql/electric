import type { SourcesByStatusViewModel } from '../../selectors/wikiStateViewModels'

const labels = {
  submitted: `Submitted`,
  published: `Published`,
  rejected: `Rejected`,
} as const

export function SourcesPanel({
  sources,
}: {
  sources: SourcesByStatusViewModel
}) {
  const total =
    sources.submitted.length +
    sources.published.length +
    sources.rejected.length
  return (
    <section
      className="lw-card"
      style={{ padding: 20 }}
      aria-labelledby="sources-panel-heading"
    >
      <h2 id="sources-panel-heading">Sources</h2>
      {total === 0 ? (
        <p>No sources yet. Submitted links and notes will be grouped here.</p>
      ) : (
        (Object.keys(labels) as Array<keyof typeof labels>).map((status) => (
          <div key={status}>
            <h3>
              {labels[status]} ({sources[status].length})
            </h3>
            <ul>
              {sources[status].map((source) => (
                <li key={source.id}>{source.title}</li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  )
}
