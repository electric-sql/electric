import type { SwarmAgent } from '../hooks/useSwarm'
import type { WikiEntry } from '../../server/schema'

interface StreamLogProps {
  agents: SwarmAgent[]
  wiki: WikiEntry[]
}

interface LogLine {
  name: string
  msg: string
  kind: string
}

function deriveLog(agents: SwarmAgent[], wiki: WikiEntry[]): LogLine[] {
  const lines: LogLine[] = []
  const wikiKeys = new Set(wiki.map((w) => w.key))
  const sorted = [...agents]
    .filter((a) => !a.isOrchestrator)
    .sort((a, b) => b.updatedAt - a.updatedAt)

  for (const a of sorted.slice(0, 12)) {
    if (a.status === `stopped`) {
      lines.push({
        name: a.name,
        msg: `stopped — state persisted`,
        kind: `kill`,
      })
    } else if (a.status === `running`) {
      const hasWiki = wikiKeys.has(a.name)
      if (hasWiki) {
        lines.push({
          name: a.name,
          msg: `writing wiki entry → /wiki/${a.topic || a.name}`,
          kind: `write`,
        })
      } else {
        lines.push({ name: a.name, msg: `reading source…`, kind: `read` })
      }
    } else if (a.status === `idle`) {
      lines.push({ name: a.name, msg: `idle — ready`, kind: `idle` })
    } else {
      lines.push({ name: a.name, msg: `spawning…`, kind: `spawn` })
    }
  }
  return lines.slice(0, 8)
}

const KIND_COLORS: Record<string, string> = {
  kill: `var(--swarm-accent-red)`,
  write: `var(--swarm-accent-orange)`,
  xref: `var(--swarm-accent-blue)`,
  read: `rgba(232,229,224,0.85)`,
  spawn: `rgba(255,255,255,0.8)`,
  idle: `rgba(255,255,255,0.4)`,
}

export function StreamLog({ agents, wiki }: StreamLogProps) {
  const log = deriveLog(agents, wiki)

  return (
    <div style={{ display: `flex`, flexDirection: `column`, minHeight: 0 }}>
      <div
        style={{
          padding: `8px 12px`,
          fontSize: 9,
          color: `var(--swarm-text-muted)`,
          letterSpacing: 1.2,
          textTransform: `uppercase`,
          borderBottom: `1px solid var(--swarm-border-subtle)`,
          display: `flex`,
          justifyContent: `space-between`,
        }}
      >
        <span>stream · tail</span>
        <span style={{ color: `var(--swarm-text-subtle)` }}>
          {log.length} lines
        </span>
      </div>
      <div
        style={{
          flex: 1,
          overflow: `hidden`,
          padding: `6px 10px`,
          fontSize: 9.5,
          lineHeight: 1.6,
        }}
      >
        {log.map((l, i) => (
          <div
            key={i}
            style={{
              display: `flex`,
              gap: 6,
              whiteSpace: `nowrap`,
              overflow: `hidden`,
            }}
          >
            <span style={{ color: `var(--swarm-text-subtle)` }}>
              {l.name.slice(0, 16)}
            </span>
            <span
              style={{
                color: KIND_COLORS[l.kind] ?? `var(--swarm-text-muted)`,
              }}
            >
              [{l.kind.padEnd(5, ` `)}]
            </span>
            <span
              style={{
                overflow: `hidden`,
                textOverflow: `ellipsis`,
                color: `rgba(255,255,255,0.72)`,
              }}
            >
              {l.msg}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
