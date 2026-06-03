import type { ReactElement } from 'react'

export function getIntakeAgentEntityUrl(wikiSpaceId: string): string {
  return `/intake-agent/${encodeURIComponent(wikiSpaceId)}`
}

export function IntakeAgentTimeline({
  wikiSpaceId,
}: {
  wikiSpaceId: string
}): ReactElement {
  const entityUrl = getIntakeAgentEntityUrl(wikiSpaceId)

  return (
    <section className="lw-private-intake" aria-label="Private intake agent">
      <div className="lw-private-intake-heading">PRIVATE INTAKE AGENT</div>
      <div
        className="lw-intake-timeline"
        data-entity-timeline="true"
        data-entity-url={entityUrl}
      >
        <p className="lw-intake-response">Intake agent timeline: {entityUrl}</p>
      </div>
    </section>
  )
}
