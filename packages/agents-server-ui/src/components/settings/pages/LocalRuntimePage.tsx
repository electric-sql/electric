import { useEffect, useState } from 'react'
import { Play, RefreshCw, Square } from 'lucide-react'
import {
  loadDesktopState,
  onDesktopStateChanged,
  type DesktopState,
} from '../../../lib/server-connection'
import { Badge, Button, Stack, Text } from '../../../ui'
import { SettingsRow, SettingsScreen, SettingsSection } from '../SettingsScreen'

const STATUS_TONES: Record<
  DesktopState[`runtimeStatus`],
  { label: string; tone: `success` | `warning` | `danger` | `info` }
> = {
  running: { label: `Running`, tone: `success` },
  starting: { label: `Starting`, tone: `info` },
  stopped: { label: `Stopped`, tone: `warning` },
  error: { label: `Error`, tone: `danger` },
}

/**
 * Settings → Local Runtime. Shows the lifecycle state of the bundled
 * Horton runtime managed by the Electron main process and exposes
 * start / restart / stop controls.
 *
 * The runtime is desktop-only; on the web build (no `electronAPI`
 * bridge) we render an explanatory message instead so the page
 * remains discoverable / informative even though there's nothing
 * to control.
 */
export function LocalRuntimePage(): React.ReactElement {
  const isDesktop = typeof window !== `undefined` && Boolean(window.electronAPI)
  const [state, setState] = useState<DesktopState | null>(null)

  useEffect(() => {
    if (!isDesktop) return
    let cancelled = false
    void loadDesktopState().then((s) => {
      if (cancelled) return
      setState(s)
    })
    const off = onDesktopStateChanged(setState)
    return () => {
      cancelled = true
      off?.()
    }
  }, [isDesktop])

  if (!isDesktop) {
    return (
      <SettingsScreen title="Local Runtime">
        <SettingsSection
          title="About"
          description="The local runtime is bundled with the Electric Agents desktop app. The web build connects to a remote agents-server instead."
        >
          <div style={{ padding: `16px` }}>
            <Text size={2} tone="muted">
              Run Electric Agents on your machine to manage the bundled local
              Horton runtime here.
            </Text>
          </div>
        </SettingsSection>
      </SettingsScreen>
    )
  }

  const status = state?.runtimeStatus ?? `stopped`
  const statusInfo = STATUS_TONES[status]
  const isRunning = status === `running`
  const isStarting = status === `starting`
  const canStart = !isRunning && !isStarting

  return (
    <SettingsScreen title="Local Runtime">
      <SettingsSection
        title="Status"
        description="The Electron app starts a local Horton runtime in-process so the desktop UI works without an external agents-server."
      >
        <SettingsRow
          label="Runtime"
          description={`The bundled Horton runtime is currently ${statusInfo.label.toLowerCase()}.`}
          control={<Badge tone={statusInfo.tone}>{statusInfo.label}</Badge>}
        />
        <SettingsRow
          label="URL"
          description="HTTP endpoint the desktop UI connects to when the runtime is active."
          control={
            <Text size={1} family={`mono`} tone={`muted`}>
              {state?.runtimeUrl ?? `—`}
            </Text>
          }
        />
        {state?.error && (
          <SettingsRow
            label="Error"
            control={
              <Text size={1} tone={`danger`}>
                {state.error}
              </Text>
            }
          />
        )}
      </SettingsSection>

      <SettingsSection
        title="Controls"
        description="Restart picks up new API keys or other environment changes; stop frees the port if you'd rather connect to a different server."
      >
        <div style={{ padding: `16px` }}>
          <Stack gap={2}>
            {canStart ? (
              <Button
                variant="solid"
                tone="accent"
                onClick={() => void window.electronAPI?.restartRuntime?.()}
              >
                <Play size={14} /> Start runtime
              </Button>
            ) : (
              <Button
                variant="soft"
                tone="neutral"
                onClick={() => void window.electronAPI?.restartRuntime?.()}
                disabled={isStarting}
              >
                <RefreshCw size={14} /> Restart runtime
              </Button>
            )}
            <Button
              variant="soft"
              tone="neutral"
              onClick={() => void window.electronAPI?.stopRuntime?.()}
              disabled={!isRunning && !isStarting}
            >
              <Square size={14} /> Stop runtime
            </Button>
          </Stack>
        </div>
      </SettingsSection>
    </SettingsScreen>
  )
}
