import { useState, useMemo, useEffect, useRef } from 'react'
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
} from 'd3-force'
import type { SwarmAgent } from '../hooks/useSwarm'
import type { WikiEntry, Xref } from '../../server/schema'

interface SwarmGraphProps {
  agents: SwarmAgent[]
  xrefs: Xref[]
  selected: string | null
  onSelect: (url: string | null) => void
  wiki: WikiEntry[]
}

interface GraphNode extends SimulationNodeDatum {
  id: string
  url: string
  name: string
  isOrchestrator: boolean
  status: string
  createdAt: number
}

interface GraphEdge {
  source: string
  target: string
  kind: `spawn` | `xref`
}

export function SwarmGraph({
  agents,
  xrefs,
  selected,
  onSelect,
  wiki,
}: SwarmGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 920, height: 640 })
  const [hover, setHover] = useState<string | null>(null)
  const [positions, setPositions] = useState<
    Map<string, { x: number; y: number }>
  >(new Map())

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      if (width > 0 && height > 0) setDimensions({ width, height })
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const { width, height } = dimensions

  const { nodes, spawnEdges, xrefEdges, hubs } = useMemo(() => {
    const nodes: GraphNode[] = agents.map((a) => ({
      id: a.url,
      url: a.url,
      name: a.name,
      isOrchestrator: a.isOrchestrator,
      status: a.status,
      createdAt: a.createdAt,
    }))

    const urlSet = new Set(agents.map((a) => a.url))

    const spawnEdges: GraphEdge[] = agents
      .filter((a) => a.parent && urlSet.has(a.parent))
      .map((a) => ({
        source: a.parent!,
        target: a.url,
        kind: `spawn` as const,
      }))

    const keyToUrl = new Map<string, string>()
    for (const a of agents) {
      keyToUrl.set(a.name, a.url)
    }

    const xrefEdges: GraphEdge[] = xrefs
      .filter((x) => keyToUrl.has(x.a) && keyToUrl.has(x.b))
      .map((x) => ({
        source: keyToUrl.get(x.a)!,
        target: keyToUrl.get(x.b)!,
        kind: `xref` as const,
      }))

    const degree = new Map<string, number>()
    for (const e of xrefEdges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1)
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1)
    }
    const hubs = [...degree.entries()]
      .filter(([url]) => !agents.find((a) => a.url === url)?.isOrchestrator)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([url]) => url)

    return { nodes, spawnEdges, xrefEdges, hubs }
  }, [agents, xrefs])

  useEffect(() => {
    if (nodes.length === 0) return

    const simNodes = nodes.map((n) => {
      const existing = positions.get(n.id)
      return {
        ...n,
        x: existing?.x ?? width / 2 + (Math.random() - 0.5) * width * 0.6,
        y: existing?.y ?? height / 2 + (Math.random() - 0.5) * height * 0.6,
      }
    })

    const orchestrator = simNodes.find((n) => n.isOrchestrator)
    if (orchestrator) {
      orchestrator.fx = width / 2
      orchestrator.fy = height / 2
    }

    const allEdges = [...spawnEdges, ...xrefEdges]
    const sim = forceSimulation(simNodes)
      .force(
        `link`,
        forceLink(allEdges)
          .id((d: any) => d.id)
          .distance((d: any) => (d.kind === `spawn` ? 120 : 80))
          .strength((d: any) => (d.kind === `spawn` ? 0.3 : 0.1))
      )
      .force(`charge`, forceManyBody().strength(-60))
      .force(`center`, forceCenter(width / 2, height / 2).strength(0.05))
      .force(`collide`, forceCollide(12))
      .alpha(0.3)
      .alphaDecay(0.02)

    sim.on(`tick`, () => {
      const next = new Map<string, { x: number; y: number }>()
      for (const n of simNodes) {
        const x = Math.max(30, Math.min(width - 30, n.x ?? width / 2))
        const y = Math.max(30, Math.min(height - 30, n.y ?? height / 2))
        next.set(n.id, { x, y })
      }
      setPositions(next)
    })

    return () => {
      sim.stop()
    }
  }, [nodes.length, spawnEdges.length, xrefEdges.length, width, height])

  const hotIds = useMemo(() => {
    const set = new Set<string>()
    if (!selected) return set
    set.add(selected)
    for (const e of xrefEdges) {
      if (e.source === selected) set.add(e.target)
      if (e.target === selected) set.add(e.source)
    }
    return set
  }, [selected, xrefEdges])

  const getPos = (id: string) => positions.get(id)

  const hoverAgent = hover ? agents.find((a) => a.url === hover) : null
  const hoverWiki = hoverAgent
    ? wiki.find(
        (w) =>
          w.key === hoverAgent.name ||
          w.author.toLowerCase().includes(hoverAgent.topic.toLowerCase())
      )
    : null
  const hoverPos = hover ? getPos(hover) : null

  return (
    <div
      ref={containerRef}
      style={{
        position: `relative`,
        minHeight: 0,
        background: `var(--swarm-bg-primary)`,
        overflow: `hidden`,
      }}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: `100%`, height: `100%`, display: `block` }}
      >
        <defs>
          <pattern
            id="swarm-grid"
            width="40"
            height="40"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke="rgba(255,255,255,0.035)"
              strokeWidth="1"
            />
          </pattern>
          <radialGradient id="swarm-glow">
            <stop offset="0%" stopColor="#d97757" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#d97757" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width={width} height={height} fill="url(#swarm-grid)" />

        {(() => {
          const orch = agents.find((a) => a.isOrchestrator)
          const pos = orch ? getPos(orch.url) : null
          return pos ? (
            <circle cx={pos.x} cy={pos.y} r={110} fill="url(#swarm-glow)" />
          ) : null
        })()}

        {spawnEdges.map((e, i) => {
          const a = getPos(e.source)
          const b = getPos(e.target)
          if (!a || !b) return null
          return (
            <line
              key={`s${i}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="rgba(255,255,255,0.09)"
              strokeWidth="0.8"
            />
          )
        })}

        {xrefEdges.map((e, i) => {
          const a = getPos(e.source)
          const b = getPos(e.target)
          if (!a || !b) return null
          const hot = hotIds.has(e.source) && hotIds.has(e.target)
          return (
            <line
              key={`x${i}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={
                hot ? `var(--swarm-accent-orange-hot)` : `rgba(217,119,87,0.42)`
              }
              strokeWidth={hot ? 1.7 : 1}
              opacity={hot ? 0.95 : 0.65}
            />
          )
        })}

        {agents.map((agent) => {
          const pos = getPos(agent.url)
          if (!pos) return null
          const isSelected = selected === agent.url
          const isHot = hotIds.has(agent.url)
          const isHub = hubs.includes(agent.url)
          const isStopped = agent.status === `stopped`
          const r = agent.isOrchestrator
            ? 13
            : isSelected
              ? 7.5
              : isHub
                ? 5.8
                : isHot
                  ? 5
                  : 3.4
          const fill = agent.isOrchestrator
            ? `var(--swarm-accent-orange)`
            : isStopped
              ? `var(--swarm-accent-red)`
              : isHot
                ? `var(--swarm-text-primary)`
                : `rgba(232,229,224,0.55)`

          return (
            <g
              key={agent.url}
              onClick={() => onSelect(isSelected ? null : agent.url)}
              onMouseEnter={() => setHover(agent.url)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: `pointer` }}
            >
              {(isSelected || hover === agent.url) && (
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={r + 5}
                  fill="none"
                  stroke="var(--swarm-accent-orange)"
                  strokeWidth="1.5"
                  opacity="0.9"
                />
              )}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={r}
                fill={fill}
                stroke="var(--swarm-bg-primary)"
                strokeWidth={agent.isOrchestrator ? 2 : 1}
              />
            </g>
          )
        })}

        {hubs.map((url) => {
          const pos = getPos(url)
          if (!pos) return null
          const agent = agents.find((a) => a.url === url)
          if (!agent) return null
          const anchor = pos.x < width / 2 ? `end` : `start`
          const dx = anchor === `end` ? -10 : 10
          return (
            <text
              key={`hub-${url}`}
              x={pos.x + dx}
              y={pos.y + 3.5}
              fontSize="10"
              fill="rgba(255,255,255,0.78)"
              textAnchor={anchor}
              fontFamily="var(--swarm-font)"
              letterSpacing="0.3"
              pointerEvents="none"
            >
              {agent.topic || agent.name}
            </text>
          )
        })}

        {(() => {
          const orch = agents.find((a) => a.isOrchestrator)
          const pos = orch ? getPos(orch.url) : null
          return pos ? (
            <text
              x={pos.x}
              y={pos.y - 18}
              fontSize="10"
              fill="var(--swarm-accent-orange)"
              textAnchor="middle"
              fontFamily="var(--swarm-font)"
              letterSpacing="1"
              pointerEvents="none"
            >
              ORCHESTRATOR
            </text>
          ) : null
        })()}
      </svg>

      <div
        style={{
          position: `absolute`,
          top: 14,
          right: 16,
          display: `flex`,
          gap: 14,
          fontSize: 9,
          color: `rgba(255,255,255,0.6)`,
          letterSpacing: 0.5,
          textTransform: `uppercase`,
        }}
      >
        <LegendLine
          color="rgba(255,255,255,0.4)"
          label={`spawn · ${spawnEdges.length}`}
        />
        <LegendLine
          color="var(--swarm-accent-orange)"
          label={`xref · ${xrefEdges.length}`}
        />
      </div>

      <div
        style={{
          position: `absolute`,
          bottom: 14,
          left: 16,
          fontSize: 9,
          color: `var(--swarm-text-muted)`,
          letterSpacing: 1,
          textTransform: `uppercase`,
        }}
      >
        density ·{` `}
        {(xrefEdges.length / Math.max(1, spawnEdges.length)).toFixed(2)}
        ×tree
      </div>

      <div
        style={{
          position: `absolute`,
          bottom: 14,
          right: 16,
          fontSize: 9,
          color: `var(--swarm-text-muted)`,
          letterSpacing: 1,
          textTransform: `uppercase`,
        }}
      >
        hover any node for wiki preview
      </div>

      {hoverAgent && hoverPos && (
        <div
          style={{
            position: `absolute`,
            left: Math.min(width - 260, Math.max(10, hoverPos.x + 12)),
            top: Math.min(height - 100, Math.max(10, hoverPos.y + 12)),
            pointerEvents: `none`,
            background: `rgba(12,12,12,0.96)`,
            border: `1px solid rgba(217,119,87,0.35)`,
            padding: `8px 10px`,
            fontSize: 10.5,
            lineHeight: 1.45,
            color: `rgba(255,255,255,0.9)`,
            width: 240,
            boxShadow: `0 4px 16px rgba(0,0,0,0.5)`,
            borderRadius: 2,
          }}
        >
          <div
            style={{
              color: `var(--swarm-accent-orange)`,
              fontSize: 9,
              letterSpacing: 1,
              textTransform: `uppercase`,
              marginBottom: 3,
            }}
          >
            {hoverAgent.status} · {hoverAgent.name}
          </div>
          <div style={{ fontSize: 11.5, marginBottom: 4 }}>
            {hoverAgent.topic || hoverAgent.name}
          </div>
          {hoverWiki ? (
            <div
              style={{
                color: `rgba(255,255,255,0.65)`,
                fontSize: 10,
              }}
            >
              {hoverWiki.body.slice(0, 110)}…
            </div>
          ) : (
            <div
              style={{
                color: `rgba(255,255,255,0.4)`,
                fontSize: 10,
                fontStyle: `italic`,
              }}
            >
              reading source · no wiki yet
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function LegendLine({ color, label }: { color: string; label: string }) {
  return (
    <div
      style={{
        display: `inline-flex`,
        alignItems: `center`,
        gap: 5,
      }}
    >
      <span style={{ width: 14, height: 2, background: color }} />
      <span>{label}</span>
    </div>
  )
}
