import { EntityTimeline } from '../../../../../../packages/agents-server-ui/src/components/EntityTimeline'
import { useEntityTimeline } from '../../../../../../packages/agents-server-ui/src/hooks/useEntityTimeline'
import { ElectricAgentsProvider } from '../../../../../../packages/agents-server-ui/src/lib/ElectricAgentsProvider'
import type { ReactElement } from 'react'

const agentsProxyBaseUrl = `/api/agents`

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
      <div className="lw-intake-timeline">
        <ElectricAgentsProvider baseUrl={agentsProxyBaseUrl}>
          <IntakeAgentEntityTimeline entityUrl={entityUrl} />
        </ElectricAgentsProvider>
      </div>
    </section>
  )
}

function IntakeAgentEntityTimeline({
  entityUrl,
}: {
  entityUrl: string
}): ReactElement {
  const { timelineRows, entities, generationActive, loading, error } =
    useEntityTimeline(agentsProxyBaseUrl, entityUrl)

  return (
    <EntityTimeline
      rows={timelineRows}
      loading={loading}
      error={error}
      entityStopped={!generationActive}
      baseUrl={agentsProxyBaseUrl}
      cacheKey={`${agentsProxyBaseUrl}${entityUrl}`}
      entityUrl={entityUrl}
      entities={entities}
    />
  )
}
