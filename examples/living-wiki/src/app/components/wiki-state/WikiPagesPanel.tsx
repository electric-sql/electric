import type { WikiPageCardViewModel } from '../../selectors/wikiStateViewModels'

const statusLabels: Record<WikiPageCardViewModel[`status`], string> = {
  canonical: `Canonical`,
  proposed: `Proposed`,
  rejected: `Rejected`,
}

export function WikiPagesPanel({ pages }: { pages: WikiPageCardViewModel[] }) {
  return (
    <section
      className="lw-card"
      style={{ padding: 20 }}
      aria-labelledby="wiki-pages-heading"
    >
      <h2 id="wiki-pages-heading">Wiki pages</h2>
      {pages.length === 0 ? (
        <p>No wiki pages yet. Propose a page from a submitted source.</p>
      ) : (
        <div style={{ display: `grid`, gap: 12 }}>
          {pages.map((page) => (
            <article
              key={page.id}
              className="lw-card"
              style={{ padding: 16, background: `rgba(255,255,255,0.72)` }}
            >
              <div
                style={{
                  display: `flex`,
                  justifyContent: `space-between`,
                  gap: 12,
                  alignItems: `start`,
                }}
              >
                <div>
                  <h3 style={{ margin: 0 }}>{page.title}</h3>
                  <p style={{ margin: `4px 0 0`, color: `#64748b` }}>
                    /{page.slug} · {page.sourceCount}
                    {` `}
                    {page.sourceCount === 1 ? `source` : `sources`}
                  </p>
                </div>
                <span
                  style={{
                    border: `1px solid #cbd5e1`,
                    borderRadius: 999,
                    padding: `2px 8px`,
                    fontSize: 12,
                    fontWeight: 700,
                    textTransform: `uppercase`,
                  }}
                >
                  {statusLabels[page.status]}
                </span>
              </div>
              {page.summary !== null ? (
                <p>{page.summary}</p>
              ) : page.bodyPreview !== null ? (
                <p>{page.bodyPreview}</p>
              ) : (
                <p style={{ color: `#64748b` }}>No page summary yet.</p>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
