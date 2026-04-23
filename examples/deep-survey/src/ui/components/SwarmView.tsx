import { useState } from 'react'
import { TopBar } from './TopBar'
import { ChatSidebar } from './ChatSidebar'
import { SwarmGraph } from './SwarmGraph'
import { WikiColumn } from './WikiColumn'
import { StreamLog } from './StreamLog'
import { ActivityHeatmap } from './ActivityHeatmap'
import { AgentList } from './AgentList'
import type { SwarmAgent } from '../hooks/useSwarm'
import type { WikiEntry, Xref } from '../../server/schema'

interface SwarmViewProps {
  agents: SwarmAgent[]
  wiki: WikiEntry[]
  xrefs: Xref[]
  connected: boolean
  darixUrl: string
  swarmId: string
  orchestratorUrl: string | null
  onSendMessage: (message: string) => void
}

export function SwarmView({
  agents,
  wiki,
  xrefs,
  connected,
  darixUrl,
  swarmId,
  orchestratorUrl,
  onSendMessage,
}: SwarmViewProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [openWikiKey, setOpenWikiKey] = useState<string | null>(null)

  const selectAgent = (url: string | null) => {
    setSelected(url)
    if (url) {
      const agent = agents.find((a) => a.url === url)
      if (agent && !agent.isOrchestrator) {
        const entry = wiki.find(
          (w) => w.key === agent.name || w.author.includes(agent.topic)
        )
        if (entry) setOpenWikiKey(entry.key)
      }
    }
  }

  const selectWiki = (key: string | null) => {
    setOpenWikiKey(key)
    if (key) {
      const entry = wiki.find((w) => w.key === key)
      if (entry) {
        const agent = agents.find((a) => a.name.includes(entry.key))
        if (agent) setSelected(agent.url)
      }
    }
  }

  const workers = agents.filter((a) => !a.isOrchestrator)
  const running = workers.filter((a) => a.status === `running`).length
  const idle = workers.filter(
    (a) => a.status === `idle` || a.status === `stopped`
  ).length

  return (
    <div
      className="swarm-root"
      style={{
        position: `absolute`,
        inset: 0,
        display: `flex`,
        flexDirection: `column`,
      }}
    >
      <TopBar
        connected={connected}
        running={running}
        idle={idle}
        wikiCount={wiki.length}
        xrefCount={xrefs.length}
        swarmId={swarmId}
      />

      <div
        style={{
          flex: 1,
          display: `grid`,
          gridTemplateColumns: `340px 1fr 340px`,
          minHeight: 0,
        }}
      >
        <ChatSidebar
          orchestratorUrl={orchestratorUrl}
          darixUrl={darixUrl}
          onSendMessage={onSendMessage}
        />
        <SwarmGraph
          agents={agents}
          xrefs={xrefs}
          selected={selected}
          onSelect={selectAgent}
          wiki={wiki}
        />
        <WikiColumn
          wiki={wiki}
          xrefs={xrefs}
          selected={selected}
          openWikiKey={openWikiKey}
          onOpen={selectWiki}
          onBack={() => setOpenWikiKey(null)}
        />
      </div>

      <div
        style={{
          display: `grid`,
          gridTemplateColumns: `340px 1fr 340px`,
          height: 160,
          minHeight: 0,
          borderTop: `1px solid var(--swarm-border-default)`,
          background: `#060606`,
        }}
      >
        <StreamLog agents={agents} wiki={wiki} />
        <div
          style={{
            padding: `10px 14px`,
            borderLeft: `1px solid var(--swarm-border-default)`,
            borderRight: `1px solid var(--swarm-border-default)`,
            minHeight: 0,
          }}
        >
          <ActivityHeatmap agents={agents} />
        </div>
        <AgentList agents={agents} selected={selected} onSelect={selectAgent} />
      </div>
    </div>
  )
}
