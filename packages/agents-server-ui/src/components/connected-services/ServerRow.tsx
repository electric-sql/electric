import { useState } from 'react'
import type { McpServerRow } from '../../hooks/useMcpServers'

export function ServerRow({
  server,
  runtimeUrl,
}: {
  server: McpServerRow
  runtimeUrl: string
}): React.ReactElement {
  const [busy, setBusy] = useState(false)
  const post = async (action: string) => {
    setBusy(true)
    try {
      await fetch(
        `${runtimeUrl}/api/mcp/servers/${encodeURIComponent(server.name)}/${action}`,
        { method: `POST` }
      )
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!window.confirm(`Remove ${server.name}?`)) return
    setBusy(true)
    try {
      await fetch(
        `${runtimeUrl}/api/mcp/servers/${encodeURIComponent(server.name)}`,
        { method: `DELETE` }
      )
    } finally {
      setBusy(false)
    }
  }
  const restartDeviceFlow = async () => {
    setBusy(true)
    try {
      await fetch(
        `${runtimeUrl}/oauth/device/${encodeURIComponent(server.name)}/start`,
        { method: `POST` }
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <article>
      <h3>{server.name}</h3>
      <dl>
        <dt>Status</dt>
        <dd>{server.status}</dd>
        <dt>Tools</dt>
        <dd>{server.toolCount}</dd>
        {server.transport && (
          <>
            <dt>Transport</dt>
            <dd>{server.transport}</dd>
          </>
        )}
        {server.authMode && (
          <>
            <dt>Auth</dt>
            <dd>{server.authMode}</dd>
          </>
        )}
        {server.error && (
          <>
            <dt>Error</dt>
            <dd>
              {server.error.kind}: {server.error.message}
            </dd>
          </>
        )}
        {server.deviceCode && (
          <>
            <dt>Device code</dt>
            <dd>
              <strong>{server.deviceCode.userCode}</strong>
            </dd>
            <dt>Verify at</dt>
            <dd>
              {server.deviceCode.verificationUriComplete ? (
                <a
                  href={server.deviceCode.verificationUriComplete}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {server.deviceCode.verificationUriComplete}
                </a>
              ) : (
                server.authUrl
              )}
            </dd>
          </>
        )}
      </dl>
      <div role="group" aria-label="Actions">
        {server.status === `authenticating` &&
          server.authUrl &&
          !server.deviceCode && (
            <a href={server.authUrl} target="_blank" rel="noopener noreferrer">
              Authorize
            </a>
          )}
        {server.deviceCode && (
          <button disabled={busy} onClick={() => void restartDeviceFlow()}>
            Restart device flow
          </button>
        )}
        <button disabled={busy} onClick={() => void post(`authorize`)}>
          Re-authorize
        </button>
        <button disabled={busy} onClick={() => void post(`reconnect`)}>
          Reconnect
        </button>
        {server.status === `disabled` ? (
          <button disabled={busy} onClick={() => void post(`enable`)}>
            Enable
          </button>
        ) : (
          <button disabled={busy} onClick={() => void post(`disable`)}>
            Disable
          </button>
        )}
        <button disabled={busy} onClick={() => void remove()}>
          Disconnect
        </button>
      </div>
    </article>
  )
}
