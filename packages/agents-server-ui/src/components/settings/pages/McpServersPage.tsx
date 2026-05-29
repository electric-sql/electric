import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  useMcpServersIpc,
  type UseMcpServersIpcResult,
} from '../../../hooks/useMcpServersIpc'
import type { McpServerRow, McpStatus } from '../../../hooks/mcpServerTypes'
import { Button, Text } from '../../../ui'
import {
  SettingsActions,
  SettingsInset,
  SettingsPanel,
  SettingsRow,
  SettingsScreen,
  SettingsSection,
  SettingsStatusBadge,
  type SettingsStatusTone,
} from '../SettingsScreen'

const STATUS_TONES: Record<
  McpStatus,
  { label: string; tone: SettingsStatusTone }
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
          <SettingsPanel>
            <Text size={2} tone="muted">
              Run Electric Agents on your machine to manage MCP servers here.
            </Text>
          </SettingsPanel>
        </SettingsSection>
      </SettingsScreen>
    )
  }

  return (
    <SettingsScreen title="MCP Servers">
      {ipc.loading ? (
        <SettingsSection title="Loading">
          <SettingsPanel>
            <Text size={2} tone="muted">
              Connecting to runtime…
            </Text>
          </SettingsPanel>
        </SettingsSection>
      ) : ipc.servers.length === 0 ? (
        <SettingsSection
          title="No servers"
          description="MCP servers declared in mcp.json will appear here once the runtime starts."
        >
          <SettingsPanel>
            <Text size={2} tone="muted">
              No MCP servers registered.
            </Text>
          </SettingsPanel>
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
        label={
          <span
            style={{
              display: `inline-flex`,
              alignItems: `baseline`,
              gap: 8,
              flexWrap: `wrap`,
            }}
          >
            <span>{server.name}</span>
            <Text size={1} tone="muted">
              {metaPieces.join(` · `)}
            </Text>
          </span>
        }
        control={
          <SettingsStatusBadge tone={statusInfo.tone}>
            {statusInfo.label}
          </SettingsStatusBadge>
        }
      />

      {/* Status-line slot — always rendered so row height stays stable. */}
      <SettingsInset>
        {server.status === `error` && server.error ? (
          <Text size={1} tone="danger">
            {server.error.kind}: {server.error.message}
          </Text>
        ) : server.status === `connecting` ? (
          <Text size={1} tone="muted">
            Loading tools…
          </Text>
        ) : server.status === `authenticating` ? (
          <Text size={1} tone="muted">
            Sign in to load tools
          </Text>
        ) : server.status === `disabled` ? (
          <Text size={1} tone="muted">
            Disabled — click Enable to resume
          </Text>
        ) : server.tools && server.tools.length > 0 ? (
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
        ) : (
          <Text size={1} tone="muted">
            No tools advertised
          </Text>
        )}
        {showTools &&
          server.status === `ready` &&
          server.tools &&
          server.tools.length > 0 && (
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
      </SettingsInset>

      <SettingsActions>
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
          <>
            {server.authMode === `authorizationCode` && (
              <Button
                variant={server.status === `authenticating` ? `solid` : `soft`}
                tone={server.status === `authenticating` ? `accent` : `neutral`}
                onClick={wrap(() => ipc.authorize(server.name))}
                disabled={busy || server.status === `connecting`}
              >
                {server.status === `ready` ? `Re-authorize` : `Authorize`}
              </Button>
            )}
            <Button
              variant="soft"
              tone="neutral"
              onClick={wrap(() => ipc.reconnect(server.name))}
              disabled={
                busy ||
                server.status === `connecting` ||
                server.status === `authenticating`
              }
            >
              Reconnect
            </Button>
            <Button
              variant="soft"
              tone="neutral"
              onClick={wrap(() => ipc.disable(server.name))}
              disabled={busy || server.status === `connecting`}
            >
              Disable
            </Button>
          </>
        )}
      </SettingsActions>
    </>
  )
}
