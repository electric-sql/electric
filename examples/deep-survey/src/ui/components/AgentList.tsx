import type { SwarmAgent } from '../hooks/useSwarm'

interface AgentListProps {
  agents: SwarmAgent[]
  selected: string | null
  onSelect: (url: string | null) => void
}

export function AgentList({ agents, selected, onSelect }: AgentListProps) {
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
        }}
      >
        agents · click to inspect
      </div>
      <div style={{ flex: 1, overflow: `auto`, fontSize: 10 }}>
        {agents.slice(0, 30).map((a) => {
          const sel = selected === a.url
          const dotColor =
            a.status === `stopped`
              ? `var(--swarm-accent-red)`
              : a.status === `running`
                ? `var(--swarm-accent-orange)`
                : a.status === `idle`
                  ? `rgba(255,255,255,0.4)`
                  : `rgba(255,255,255,0.15)`

          return (
            <div
              key={a.url}
              onClick={() => onSelect(sel ? null : a.url)}
              style={{
                padding: `3px 12px`,
                display: `flex`,
                alignItems: `center`,
                gap: 8,
                background: sel
                  ? `rgba(217,119,87,0.12)`
                  : a.status === `stopped`
                    ? `rgba(239,68,68,0.08)`
                    : `transparent`,
                borderLeft: sel
                  ? `2px solid var(--swarm-accent-orange)`
                  : `2px solid transparent`,
                cursor: `pointer`,
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: 1,
                  background: dotColor,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  flex: 1,
                  overflow: `hidden`,
                  textOverflow: `ellipsis`,
                  whiteSpace: `nowrap`,
                }}
              >
                {a.topic || a.name}
              </span>
              <span
                style={{
                  color: `var(--swarm-text-subtle)`,
                  fontSize: 9,
                }}
              >
                {a.status}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
