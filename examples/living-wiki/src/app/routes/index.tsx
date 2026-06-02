import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute(`/` as never)({
  component: IndexRoute,
})

function IndexRoute() {
  return (
    <section className="lw-card" style={{ padding: 32 }}>
      <p
        style={{
          color: `var(--lw-muted)`,
          fontWeight: 700,
          letterSpacing: `0.08em`,
          textTransform: `uppercase`,
        }}
      >
        Electric Agents Demo
      </p>
      <h1 style={{ fontSize: 56, lineHeight: 1, margin: `12px 0 16px` }}>
        Living Wiki
      </h1>
      <p
        style={{
          color: `var(--lw-muted)`,
          fontSize: 20,
          lineHeight: 1.5,
          maxWidth: 760,
        }}
      >
        A multiplayer substrate-engineering demo where humans and agents compile
        sources into a living wiki graph.
      </p>
      <div id="health-panel-root" />
    </section>
  )
}
