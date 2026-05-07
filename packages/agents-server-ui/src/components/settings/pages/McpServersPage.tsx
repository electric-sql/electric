import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  useMcpServersIpc,
  type UseMcpServersIpcResult,
} from '../../../hooks/useMcpServersIpc'
import type { McpServerRow, McpStatus } from '../../../hooks/mcpServerTypes'
import { Badge, Button, Text } from '../../../ui'
import { SettingsRow, SettingsScreen, SettingsSection } from '../SettingsScreen'

const STATUS_TONES: Record<
  McpStatus,
  { label: string; tone: `success` | `warning` | `danger` | `info` | `neutral` }
> = {
  ready: { label: `Ready`, tone: `success` },
  connecting: { label: `Connecting`, tone: `info` },
  authenticating: { label: `Sign in required`, tone: `warning` },
  error: { label: `Error`, tone: `danger` },
  disabled: { label: `Disabled`, tone: `neutral` },
}

/**
 * Settings → MCP Servers. Shows the in-process MCP registry's servers,
 * pushed over IPC from the embedded BuiltinAgentsServer's registry.
 *
 * Desktop-only: in non-Electron contexts the hook returns an empty list
 * and the page renders a hint to launch the desktop app. The sidebar
 * entry is also hidden when `electronAPI` isn't present.
 */
export function McpServersPage(): React.ReactElement {
  const isDesktop = typeof window !== `undefined` && Boolean(window.electronAPI)
  const ipc = useMcpServersIpc()

  if (!isDesktop) {
    return (
      <SettingsScreen title="MCP Servers">
        <SettingsSection
          title="About"
          description="MCP server management is part of the desktop app. The web build connects to a remote agents-server instead."
        >
          <div style={{ padding: `16px` }}>
            <Text size={2} tone="muted">
              Run Electric Agents on your machine to manage MCP servers here.
            </Text>
          </div>
        </SettingsSection>
      </SettingsScreen>
    )
  }

  return (
    <SettingsScreen title="MCP Servers">
      {ipc.loading ? (
        <SettingsSection title="Loading">
          <div style={{ padding: `16px` }}>
            <Text size={2} tone="muted">
              Connecting to runtime…
            </Text>
          </div>
        </SettingsSection>
      ) : ipc.servers.length === 0 ? (
        <SettingsSection
          title="No servers"
          description="MCP servers declared in mcp.json will appear here once the runtime starts."
        >
          <div style={{ padding: `16px` }}>
            <Text size={2} tone="muted">
              No MCP servers registered.
            </Text>
          </div>
        </SettingsSection>
      ) : (
        <SettingsSection
          title="Servers"
          description="Connected Model Context Protocol servers and their tools."
        >
          {ipc.servers.map((s) => (
            <ServerEntry key={s.name} server={s} ipc={ipc} />
          ))}
        </SettingsSection>
      )}
    </SettingsScreen>
  )
}

function ServerEntry({
  server,
  ipc,
}: {
  server: McpServerRow
  ipc: UseMcpServersIpcResult
}): React.ReactElement {
  const [busy, setBusy] = useState(false)
  const [showTools, setShowTools] = useState(false)
  const statusInfo = STATUS_TONES[server.status]

  const wrap = (fn: () => Promise<void>) => async () => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  const metaPieces: string[] = []
  if (server.transport) metaPieces.push(server.transport)
  if (server.authMode) metaPieces.push(`auth: ${server.authMode}`)
  metaPieces.push(
    `${server.toolCount} tool${server.toolCount === 1 ? `` : `s`}`
  )

  return (
    <>
      <SettingsRow
        label={server.name}
        description={metaPieces.join(` · `)}
        control={<Badge tone={statusInfo.tone}>{statusInfo.label}</Badge>}
      />

      {server.error && (
        <div style={{ padding: `0 16px 12px` }}>
          <Text size={1} tone="danger">
            {server.error.kind}: {server.error.message}
          </Text>
        </div>
      )}

      {server.tools && server.tools.length > 0 && (
        <div style={{ padding: `0 16px 12px` }}>
          <button
            type="button"
            onClick={() => setShowTools((v) => !v)}
            style={{
              display: `inline-flex`,
              alignItems: `center`,
              gap: 4,
              background: `transparent`,
              border: `none`,
              padding: 0,
              cursor: `pointer`,
              color: `inherit`,
              font: `inherit`,
            }}
          >
            {showTools ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Text size={1} tone="muted">
              {showTools ? `Hide` : `Show`} {server.tools.length} tool
              {server.tools.length === 1 ? `` : `s`}
            </Text>
          </button>
          {showTools && (
            <ul
              style={{
                listStyle: `none`,
                padding: 0,
                margin: `8px 0 0`,
                display: `grid`,
                gap: 4,
              }}
            >
              {server.tools.map((t) => (
                <li key={t.name}>
                  <Text size={1} family="mono">
                    {t.name}
                  </Text>
                  {t.description && (
                    <>
                      {` `}
                      <Text size={1} tone="muted">
                        — {t.description}
                      </Text>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div
        style={{
          display: `flex`,
          flexWrap: `wrap`,
          gap: 8,
          padding: `0 16px 16px`,
        }}
      >
        {server.status === `authenticating` && (
          <Button
            variant="solid"
            tone="accent"
            onClick={wrap(() => ipc.authorize(server.name))}
            disabled={busy}
          >
            Authorize
          </Button>
        )}
        {server.status !== `disabled` && server.status !== `authenticating` && (
          <Button
            variant="soft"
            tone="neutral"
            onClick={wrap(() => ipc.reconnect(server.name))}
            disabled={busy}
          >
            Reconnect
          </Button>
        )}
        {server.status === `disabled` ? (
          <Button
            variant="soft"
            tone="neutral"
            onClick={wrap(() => ipc.enable(server.name))}
            disabled={busy}
          >
            Enable
          </Button>
        ) : (
          <Button
            variant="soft"
            tone="neutral"
            onClick={wrap(() => ipc.disable(server.name))}
            disabled={busy}
          >
            Disable
          </Button>
        )}
      </div>
    </>
  )
}
