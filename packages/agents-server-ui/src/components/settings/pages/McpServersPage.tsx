import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  useMcpServersIpc,
  type McpServerConfigInput,
  type UseMcpServersIpcResult,
} from '../../../hooks/useMcpServersIpc'
import type { McpServerRow, McpStatus } from '../../../hooks/mcpServerTypes'
import {
  Badge,
  Button,
  ConfirmDialog,
  Icon,
  IconButton,
  Text,
} from '../../../ui'
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
import { McpServerFormDialog } from './McpServerFormDialog'

const STATUS_TONES: Record<
  McpStatus,
  { label: string; tone: SettingsStatusTone }
> = {
  ready: { label: `Ready`, tone: `success` },
  connecting: { label: `Connecting`, tone: `info` },
  authenticating: { label: `Sign in required`, tone: `warning` },
  error: { label: `Error`, tone: `danger` },
  disabled: { label: `Disabled`, tone: `neutral` },
  shadowed: { label: `Overridden`, tone: `neutral` },
}

/**
 * Settings → MCP Servers. Shows the in-process MCP registry's servers,
 * pushed over IPC from the embedded BuiltinAgentsServer's registry.
 *
 * Add / Edit / Remove operate on the desktop's global `settings.json`
 * mcp.servers block. Rows that came from workspace `mcp.json` or from
 * programmatic extras are read-only. When a settings.json entry's name
 * is also claimed by workspace mcp.json, the workspace wins (existing
 * registry rule) and the settings entry renders as `shadowed`.
 *
 * Desktop-only: in non-Electron contexts the hook returns an empty list
 * and the page renders a hint to launch the desktop app.
 */
export function McpServersPage(): React.ReactElement {
  const isDesktop = typeof window !== `undefined` && Boolean(window.electronAPI)
  const ipc = useMcpServersIpc()
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<McpServerConfigInput | null>(
    null
  )

  const existingSettingsNames = useMemo(
    () =>
      ipc.servers.filter((s) => s.provenance === `settings`).map((s) => s.name),
    [ipc.servers]
  )

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

  const addAction = (
    <Button
      onClick={() => {
        setEditTarget(null)
        setFormOpen(true)
      }}
    >
      <Icon icon={Plus} size={2} />
      Add server
    </Button>
  )

  const handleSubmit = async (cfg: McpServerConfigInput): Promise<void> => {
    await ipc.upsert(cfg)
  }

  return (
    <SettingsScreen title="MCP Servers" action={addAction}>
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
          description="Click 'Add server' to register your first MCP server, or define entries in a workspace mcp.json."
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
            <ServerEntry
              key={`${s.name}:${s.shadowed ? `shadowed` : `live`}`}
              server={s}
              ipc={ipc}
              onEdit={() => {
                if (s.config) {
                  setEditTarget(s.config as McpServerConfigInput)
                  setFormOpen(true)
                }
              }}
            />
          ))}
        </SettingsSection>
      )}

      <McpServerFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        initial={editTarget ?? undefined}
        onSubmit={handleSubmit}
        existingNames={existingSettingsNames}
      />
    </SettingsScreen>
  )
}

function ServerEntry({
  server,
  ipc,
  onEdit,
}: {
  server: McpServerRow
  ipc: UseMcpServersIpcResult
  onEdit: () => void
}): React.ReactElement {
  const [busy, setBusy] = useState(false)
  const [showTools, setShowTools] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const statusInfo = STATUS_TONES[server.status]
  const isSettings = server.provenance === `settings`
  const isShadowed = server.shadowed

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
  if (!isShadowed) {
    metaPieces.push(
      `${server.toolCount} tool${server.toolCount === 1 ? `` : `s`}`
    )
  }

  return (
    <div style={isShadowed ? { opacity: 0.55 } : undefined}>
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
            {server.provenance === `workspace` && (
              <Badge size={1} tone="neutral" variant="soft">
                from mcp.json
              </Badge>
            )}
            {server.provenance === `extras` && (
              <Badge size={1} tone="neutral" variant="soft">
                programmatic
              </Badge>
            )}
            {isShadowed && (
              <Badge size={1} tone="warning" variant="soft">
                overridden by mcp.json
              </Badge>
            )}
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
        {isShadowed ? (
          <Text size={1} tone="muted">
            The workspace mcp.json defines a server with the same name —
            workspace wins. Remove the workspace entry to use this one.
          </Text>
        ) : server.status === `error` && server.error ? (
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
        {isShadowed ? (
          // Settings-side entry that's been overridden — only Edit/Remove
          // make sense here (lifecycle verbs go to the workspace twin).
          <>
            <Button
              variant="soft"
              tone="neutral"
              onClick={onEdit}
              disabled={busy}
            >
              <Icon icon={Pencil} size={1} />
              Edit
            </Button>
            <Button
              variant="soft"
              tone="danger"
              onClick={() => setConfirmRemove(true)}
              disabled={busy}
            >
              <Icon icon={Trash2} size={1} />
              Remove
            </Button>
          </>
        ) : server.status === `disabled` ? (
          <>
            <Button
              variant="soft"
              tone="neutral"
              onClick={wrap(() => ipc.enable(server.name))}
              disabled={busy}
            >
              Enable
            </Button>
            {isSettings && (
              <>
                <Button
                  variant="soft"
                  tone="neutral"
                  onClick={onEdit}
                  disabled={busy}
                >
                  <Icon icon={Pencil} size={1} />
                  Edit
                </Button>
                <Button
                  variant="soft"
                  tone="danger"
                  onClick={() => setConfirmRemove(true)}
                  disabled={busy}
                >
                  <Icon icon={Trash2} size={1} />
                  Remove
                </Button>
              </>
            )}
          </>
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
            {isSettings && (
              <>
                <IconButton
                  variant="ghost"
                  tone="neutral"
                  size={1}
                  aria-label="Edit"
                  onClick={onEdit}
                  disabled={busy || server.status === `authenticating`}
                >
                  <Icon icon={Pencil} size={2} />
                </IconButton>
                <IconButton
                  variant="ghost"
                  tone="danger"
                  size={1}
                  aria-label="Remove"
                  onClick={() => setConfirmRemove(true)}
                  disabled={busy}
                >
                  <Icon icon={Trash2} size={2} />
                </IconButton>
              </>
            )}
          </>
        )}
      </SettingsActions>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={`Remove "${server.name}"?`}
        description={`This removes ${server.name} from settings.json. Workspace mcp.json entries are not affected.`}
        confirmLabel="Remove"
        confirmTone="danger"
        onConfirm={async () => {
          await ipc.remove(server.name)
        }}
      />
    </div>
  )
}
