interface TopBarProps {
  connected: boolean
  running: number
  idle: number
  wikiCount: number
  xrefCount: number
  swarmId: string
}

function StatusChip({
  label,
  value,
  accent,
  pulse,
  kill,
}: {
  label: string
  value: string | number
  accent?: boolean
  pulse?: boolean
  kill?: boolean
}) {
  const color = kill
    ? `var(--swarm-accent-red)`
    : accent
      ? `var(--swarm-accent-orange)`
      : `#fff`

  return (
    <div
      style={{
        display: `flex`,
        alignItems: `baseline`,
        gap: 6,
        padding: `3px 10px`,
        background: `var(--swarm-bg-chip)`,
        border: `1px solid var(--swarm-border-subtle)`,
      }}
    >
      {pulse && (
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: 3,
            background: color,
            animation: `swarm-blink 0.6s steps(2) infinite`,
            marginRight: 2,
          }}
        />
      )}
      <span
        style={{
          fontSize: 9,
          color: `var(--swarm-text-muted)`,
          textTransform: `uppercase`,
          letterSpacing: 0.8,
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 12.5, color, fontWeight: 500 }}>{value}</span>
    </div>
  )
}

export function TopBar({
  connected,
  running,
  idle,
  wikiCount,
  xrefCount,
  swarmId,
}: TopBarProps) {
  return (
    <div
      style={{
        display: `flex`,
        alignItems: `center`,
        gap: 16,
        padding: `10px 18px`,
        borderBottom: `1px solid var(--swarm-border-default)`,
        background: `var(--swarm-bg-topbar)`,
      }}
    >
      <div
        style={{
          display: `flex`,
          alignItems: `center`,
          gap: 9,
          cursor: `pointer`,
        }}
        onClick={() => {
          window.location.hash = ``
        }}
      >
        <div
          style={{
            width: 16,
            height: 16,
            borderRadius: 2,
            background: `var(--swarm-accent-orange)`,
            display: `flex`,
            alignItems: `center`,
            justifyContent: `center`,
            color: `#fff`,
            fontSize: 9,
            fontWeight: 700,
          }}
        >
          D
        </div>
        <span style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: 1 }}>
          DARIX
        </span>
        <span style={{ color: `rgba(255,255,255,0.25)` }}>·</span>
        <span style={{ color: `rgba(255,255,255,0.55)`, fontSize: 11 }}>
          {swarmId}
        </span>
      </div>
      <span style={{ flex: 1 }} />
      {!connected && (
        <span style={{ fontSize: 9, color: `var(--swarm-accent-red)` }}>
          disconnected
        </span>
      )}
      <StatusChip label="running" value={running} accent pulse={running > 0} />
      <StatusChip label="idle" value={idle} />
      <StatusChip label="wiki" value={wikiCount} />
      <StatusChip label="xrefs" value={xrefCount} accent />
    </div>
  )
}
