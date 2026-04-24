import type { WikiEntry, Xref } from '../../server/schema'

interface WikiColumnProps {
  wiki: WikiEntry[]
  xrefs: Xref[]
  selected: string | null
  openWikiKey: string | null
  onOpen: (key: string) => void
  onBack: () => void
}

export function WikiColumn({
  wiki,
  xrefs,
  selected,
  openWikiKey,
  onOpen,
  onBack,
}: WikiColumnProps) {
  const openPage = openWikiKey ? wiki.find((w) => w.key === openWikiKey) : null

  return (
    <div
      style={{
        borderLeft: `1px solid var(--swarm-border-default)`,
        background: `var(--swarm-bg-panel)`,
        display: `flex`,
        flexDirection: `column`,
        minHeight: 0,
      }}
    >
      {openPage ? (
        <WikiPage
          page={openPage}
          xrefs={xrefs}
          wiki={wiki}
          onBack={onBack}
          onJump={onOpen}
        />
      ) : (
        <WikiTOC
          wiki={wiki}
          xrefs={xrefs}
          selected={selected}
          onOpen={onOpen}
        />
      )}
    </div>
  )
}

function WikiTOC({
  wiki,
  xrefs,
  selected,
  onOpen,
}: {
  wiki: WikiEntry[]
  xrefs: Xref[]
  selected: string | null
  onOpen: (key: string) => void
}) {
  return (
    <>
      <div
        style={{
          padding: `12px 14px`,
          borderBottom: `1px solid var(--swarm-border-subtle)`,
        }}
      >
        <div
          style={{
            fontSize: 9,
            color: `var(--swarm-text-muted)`,
            letterSpacing: 1.2,
            textTransform: `uppercase`,
            marginBottom: 4,
          }}
        >
          /wiki · live
        </div>
        <div style={{ fontSize: 11.5, color: `var(--swarm-text-primary)` }}>
          <span
            style={{
              color: `var(--swarm-accent-orange)`,
              fontWeight: 500,
            }}
          >
            {wiki.length}
          </span>
          {` `}
          pages ·{` `}
          <span
            style={{
              color: `var(--swarm-accent-orange)`,
              fontWeight: 500,
            }}
          >
            {xrefs.length}
          </span>
          {` `}
          cross-refs
        </div>
      </div>
      <div style={{ flex: 1, overflow: `auto` }}>
        {wiki.slice(0, 30).map((w) => {
          const myXrefs = xrefs.filter(
            (x) => x.a === w.key || x.b === w.key
          ).length

          return (
            <div
              key={w.key}
              onClick={() => onOpen(w.key)}
              style={{
                padding: `7px 14px`,
                borderBottom: `1px solid var(--swarm-border-subtle)`,
                cursor: `pointer`,
                background:
                  selected && w.key.includes(selected.split(`/`).pop() ?? ``)
                    ? `rgba(217,119,87,0.1)`
                    : `transparent`,
              }}
            >
              <div
                style={{
                  display: `flex`,
                  alignItems: `baseline`,
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 9,
                    color: `var(--swarm-accent-orange)`,
                  }}
                >
                  {w.key.slice(0, 12)}
                </span>
                <span
                  style={{
                    fontSize: 11.5,
                    color: `var(--swarm-text-primary)`,
                    fontWeight: 500,
                    flex: 1,
                    overflow: `hidden`,
                    textOverflow: `ellipsis`,
                    whiteSpace: `nowrap`,
                  }}
                >
                  {w.title}
                </span>
                {myXrefs > 0 && (
                  <span
                    style={{
                      fontSize: 9,
                      color: `var(--swarm-text-muted)`,
                    }}
                  >
                    ↳{myXrefs}
                  </span>
                )}
                {w.improved && (
                  <span
                    style={{
                      fontSize: 8.5,
                      color: `var(--swarm-accent-blue)`,
                    }}
                  >
                    ↻
                  </span>
                )}
              </div>
            </div>
          )
        })}
        {wiki.length === 0 && (
          <div
            style={{
              padding: 20,
              color: `var(--swarm-text-muted)`,
              fontSize: 11,
              fontStyle: `italic`,
            }}
          >
            — no entries yet. agents are drafting… —
          </div>
        )}
      </div>
    </>
  )
}

function WikiPage({
  page,
  xrefs,
  wiki,
  onBack,
  onJump,
}: {
  page: WikiEntry
  xrefs: Xref[]
  wiki: WikiEntry[]
  onBack: () => void
  onJump: (key: string) => void
}) {
  const relatedXrefs = xrefs.filter((x) => x.a === page.key || x.b === page.key)
  const relatedKeys = relatedXrefs.map((x) => (x.a === page.key ? x.b : x.a))
  const relatedPages = relatedKeys
    .map((key) => wiki.find((w) => w.key === key))
    .filter(Boolean) as WikiEntry[]

  return (
    <>
      <div
        style={{
          padding: `10px 14px`,
          borderBottom: `1px solid var(--swarm-border-subtle)`,
          display: `flex`,
          alignItems: `center`,
          gap: 8,
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: `transparent`,
            border: `1px solid var(--swarm-border-subtle)`,
            color: `var(--swarm-text-muted)`,
            cursor: `pointer`,
            padding: `2px 6px`,
            fontSize: 10,
            fontFamily: `inherit`,
            borderRadius: 2,
          }}
        >
          ← toc
        </button>
        <span
          style={{
            fontSize: 10,
            color: `var(--swarm-accent-orange)`,
            letterSpacing: 0.8,
          }}
        >
          {page.key}
        </span>
        {page.improved && (
          <span
            style={{
              fontSize: 9,
              color: `var(--swarm-accent-blue)`,
              marginLeft: `auto`,
            }}
          >
            ↻ improved
          </span>
        )}
      </div>
      <div style={{ flex: 1, padding: 16, overflow: `auto` }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: `var(--swarm-text-primary)`,
            marginBottom: 10,
            wordBreak: `break-word`,
          }}
        >
          /wiki/{page.title}
        </div>
        <div
          style={{
            fontSize: 11,
            color: `rgba(255,255,255,0.78)`,
            lineHeight: 1.65,
            marginBottom: 16,
          }}
        >
          {page.body}
        </div>
        {page.improved && (
          <div
            style={{
              background: `rgba(52,199,89,0.08)`,
              borderLeft: `2px solid var(--swarm-accent-green)`,
              padding: `7px 10px`,
              fontSize: 10.5,
              color: `rgba(255,255,255,0.8)`,
              lineHeight: 1.55,
              marginBottom: 14,
            }}
          >
            <div
              style={{
                color: `var(--swarm-accent-green)`,
                fontSize: 9,
                letterSpacing: 1,
                textTransform: `uppercase`,
                marginBottom: 3,
              }}
            >
              + improved
            </div>
            Cross-reference added: shares pattern with {relatedPages.length}
            {` `}
            sibling
            {relatedPages.length !== 1 ? `s` : ``}.
          </div>
        )}
        {relatedPages.length > 0 && (
          <>
            <div
              style={{
                fontSize: 9.5,
                color: `var(--swarm-text-muted)`,
                letterSpacing: 1,
                textTransform: `uppercase`,
                marginBottom: 6,
              }}
            >
              cross-refs · {relatedPages.length}
            </div>
            <div
              style={{
                display: `flex`,
                flexDirection: `column`,
                gap: 2,
              }}
            >
              {relatedPages.slice(0, 10).map((p) => (
                <div
                  key={p.key}
                  onClick={() => onJump(p.key)}
                  style={{
                    padding: `4px 8px`,
                    background: `rgba(255,255,255,0.03)`,
                    cursor: `pointer`,
                    display: `flex`,
                    gap: 8,
                    alignItems: `baseline`,
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      color: `var(--swarm-accent-orange)`,
                    }}
                  >
                    →
                  </span>
                  <span
                    style={{
                      fontSize: 10.5,
                      color: `var(--swarm-text-primary)`,
                    }}
                  >
                    {p.title}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  )
}
