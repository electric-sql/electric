import type { SwarmAgent } from '../hooks/useSwarm'

interface ActivityHeatmapProps {
  agents: SwarmAgent[]
}

export function ActivityHeatmap({ agents }: ActivityHeatmapProps) {
  const workers = agents.filter((a) => !a.isOrchestrator).slice(0, 32)

  if (workers.length === 0) {
    return (
      <div
        style={{
          display: `flex`,
          alignItems: `center`,
          justifyContent: `center`,
          height: `100%`,
          fontSize: 10,
          color: `var(--swarm-text-muted)`,
        }}
      >
        waiting for agents…
      </div>
    )
  }

  const statusColor = (status: string): string => {
    switch (status) {
      case `running`:
        return `rgba(217,119,87,0.9)`
      case `idle`:
        return `rgba(255,255,255,0.25)`
      case `stopped`:
        return `rgba(239,68,68,0.9)`
      case `spawning`:
        return `rgba(255,255,255,0.7)`
      default:
        return `rgba(255,255,255,0.1)`
    }
  }

  return (
    <div style={{ display: `flex`, flexDirection: `column`, height: `100%` }}>
      <div
        style={{
          display: `flex`,
          alignItems: `baseline`,
          justifyContent: `space-between`,
          marginBottom: 6,
        }}
      >
        <div
          style={{
            fontSize: 9,
            color: `var(--swarm-text-muted)`,
            letterSpacing: 1,
            textTransform: `uppercase`,
          }}
        >
          agent activity · {workers.length} agents
        </div>
      </div>
      <div
        style={{
          flex: 1,
          display: `grid`,
          gridTemplateColumns: `repeat(${Math.min(workers.length, 32)}, 1fr)`,
          gap: 1,
          minHeight: 0,
        }}
      >
        {workers.map((a) => (
          <div
            key={a.url}
            style={{
              background: statusColor(a.status),
              minHeight: 5,
              borderRadius: 1,
            }}
            title={`${a.name}: ${a.status}`}
          />
        ))}
      </div>
      <div
        style={{
          display: `flex`,
          gap: 14,
          marginTop: 6,
          fontSize: 9,
          color: `var(--swarm-text-muted)`,
          letterSpacing: 0.4,
        }}
      >
        <HmLegend color="rgba(255,255,255,0.7)" label="spawn" />
        <HmLegend color="rgba(217,119,87,0.9)" label="running" />
        <HmLegend color="rgba(255,255,255,0.25)" label="idle" />
        <HmLegend color="rgba(239,68,68,0.9)" label="stopped" />
      </div>
    </div>
  )
}

function HmLegend({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: `flex`, alignItems: `center`, gap: 4 }}>
      <span style={{ width: 8, height: 8, background: color }} />
      <span>{label}</span>
    </div>
  )
}
