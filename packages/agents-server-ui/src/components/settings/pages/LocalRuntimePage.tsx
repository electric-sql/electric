import { useEffect, useMemo, useState } from 'react'
import { useSearch } from '@tanstack/react-router'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { appendPathToUrl } from '@electric-ax/agents-runtime/client'
import { Play, RefreshCw, Square } from 'lucide-react'
import {
  loadDesktopState,
  onDesktopStateChanged,
  type DesktopState,
  type LocalRuntimeStatus,
} from '../../../lib/server-connection'
import {
  createRunnersCollection,
  createRunnerRuntimeDiagnosticsCollection,
  useElectricAgents,
  type ElectricRunner,
  type ElectricRunnerRuntimeDiagnostics,
} from '../../../lib/ElectricAgentsProvider'
import { formatRelativeTime } from '../../../lib/formatTime'
import { Button, Icon, Select, Stack, Text } from '../../../ui'
import {
  SettingsPanel,
  SettingsRow,
  SettingsScreen,
  SettingsSection,
  SettingsStatusBadge,
  type SettingsStatusTone,
} from '../SettingsScreen'
import type { ServerConfig } from '../../../lib/types'

const STATUS_TONES: Record<
  LocalRuntimeStatus,
  { label: string; tone: SettingsStatusTone }
> = {
  running: { label: `Running`, tone: `success` },
  starting: { label: `Starting`, tone: `info` },
  stopped: { label: `Stopped`, tone: `warning` },
  error: { label: `Error`, tone: `danger` },
  disabled: { label: `Disabled`, tone: `neutral` },
}

const RUNNER_HEALTH_TONES: Record<
  `healthy` | `degraded` | `unhealthy` | `unknown`,
  { label: string; tone: SettingsStatusTone }
> = {
  healthy: { label: `Healthy`, tone: `success` },
  degraded: { label: `Degraded`, tone: `warning` },
  unhealthy: { label: `Unhealthy`, tone: `danger` },
  unknown: { label: `Unknown`, tone: `neutral` },
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function runnerHealth(
  runner: ElectricRunner | null,
  runtimeDiagnostics: ElectricRunnerRuntimeDiagnostics | null,
  now: number = Date.now()
): { status: keyof typeof RUNNER_HEALTH_TONES; issues: Array<string> } {
  if (!runner) return { status: `unknown`, issues: [`Runner not synced`] }
  const issues: Array<string> = []
  let status: keyof typeof RUNNER_HEALTH_TONES = `healthy`
  const escalate = (floor: `degraded` | `unhealthy`) => {
    if (floor === `unhealthy`) status = `unhealthy`
    else if (status === `healthy`) status = `degraded`
  }

  if (runner.admin_status === `disabled`) {
    escalate(`unhealthy`)
    issues.push(`Disabled`)
  }

  const leaseExpiresAt = parseTime(
    runtimeDiagnostics?.liveness_lease_expires_at ??
      runner.liveness_lease_expires_at
  )
  if (leaseExpiresAt === null) {
    escalate(`degraded`)
    issues.push(`No heartbeat`)
  } else if (leaseExpiresAt <= now) {
    escalate(`unhealthy`)
    issues.push(`Lease expired`)
  }

  const diagnostics = runtimeDiagnostics?.diagnostics ?? runner.diagnostics
  if (!diagnostics) {
    if (runtimeDiagnostics?.last_seen_at ?? runner.last_seen_at) {
      escalate(`degraded`)
      issues.push(`No diagnostics`)
    }
  } else {
    if (diagnostics.stream_connected === false) {
      escalate(`degraded`)
      issues.push(`Stream disconnected`)
    }
    if (diagnostics.last_heartbeat_ok === false) {
      escalate(`degraded`)
      issues.push(`Heartbeat failed`)
    }
    if ((diagnostics.reconnect_count ?? 0) > 5) {
      escalate(`degraded`)
      issues.push(`${diagnostics.reconnect_count} reconnects`)
    }
  }

  return { status, issues }
}

function timeLabel(value: string | null | undefined): string {
  const ts = parseTime(value)
  return ts === null ? `-` : formatRelativeTime(ts)
}

function countLabel(value: number | undefined): string {
  return String(value ?? 0)
}

type RunnerDiagnostics = NonNullable<ElectricRunner[`diagnostics`]>

function runtimeConnectionLabel(value: string | null | undefined): string {
  if (!value) return `-`
  return `Pull-wake`
}

function runnerHealthEndpoint(
  baseUrl: string | null | undefined,
  runnerId: string | null | undefined
): string | null {
  if (!baseUrl || !runnerId) return null
  return appendPathToUrl(
    baseUrl,
    `/_electric/runners/${encodeURIComponent(runnerId)}/health`
  )
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
  const search = useSearch({ strict: false }) as { serverId?: string }
  const requestedServerId = search.serverId ?? null
  const [state, setState] = useState<DesktopState | null>(null)
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const { runnersCollection: activeRunnersCollection } = useElectricAgents()
  const runtimeServers = useMemo(
    () =>
      (state?.servers ?? []).filter(
        (server) => server.localRuntimeEnabled !== false
      ),
    [state?.servers]
  )
  const selectedServer =
    runtimeServers.find((server) => server.id === selectedServerId) ?? null
  const connectionByServerId = useMemo(
    () =>
      new Map(
        (state?.connections ?? []).map((entry) => [entry.serverId, entry])
      ),
    [state?.connections]
  )
  const selectedConnection = selectedServer
    ? (connectionByServerId.get(selectedServer.id) ?? null)
    : null
  const selectedRuntimeStatus: LocalRuntimeStatus =
    selectedConnection?.localRuntimeStatus ??
    (selectedServer?.localRuntimeEnabled === false ? `disabled` : `stopped`)
  const selectedServerIsActive = selectedServer?.id === state?.activeServer?.id
  const selectedServerRunnersCollection = useMemo(() => {
    if (!selectedServer?.url || selectedServerIsActive) return null
    return createRunnersCollection(selectedServer.url)
  }, [selectedServer?.url, selectedServerIsActive])
  const runnersCollection = selectedServerIsActive
    ? activeRunnersCollection
    : selectedServerRunnersCollection
  const runnerId = state?.pullWakeRunnerId ?? null
  const { data: runnerRows = [] } = useLiveQuery(
    (query) => {
      if (!runnersCollection || !runnerId) return undefined
      return query
        .from({ runner: runnersCollection })
        .where(({ runner }) => eq(runner.id, runnerId))
    },
    [runnersCollection, runnerId]
  )
  const runner = runnerRows[0] ?? null
  const healthEndpoint = runnerHealthEndpoint(selectedServer?.url, runnerId)
  const diagnosticsCollection = useMemo(() => {
    if (!selectedServer?.url || !runnerId) return null
    return createRunnerRuntimeDiagnosticsCollection(
      selectedServer.url,
      runnerId
    )
  }, [selectedServer?.url, runnerId])
  const { data: runtimeDiagnosticsRows = [] } = useLiveQuery(
    (query) => {
      if (!diagnosticsCollection) return undefined
      return query.from({ diagnostics: diagnosticsCollection })
    },
    [diagnosticsCollection]
  )
  const runnerTelemetry = runtimeDiagnosticsRows[0] ?? null
  const health = runnerHealth(runner, runnerTelemetry, now)
  const healthTone = RUNNER_HEALTH_TONES[health.status]
  const diagnostics: RunnerDiagnostics | null =
    runnerTelemetry?.diagnostics ?? runner?.diagnostics ?? null

  useEffect(() => {
    if (!isDesktop) return
    const interval = window.setInterval(() => setNow(Date.now()), 5000)
    return () => window.clearInterval(interval)
  }, [isDesktop])

  useEffect(() => {
    return () => {
      diagnosticsCollection?.cleanup()
    }
  }, [diagnosticsCollection])

  useEffect(() => {
    return () => {
      selectedServerRunnersCollection?.cleanup()
    }
  }, [selectedServerRunnersCollection])

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

  useEffect(() => {
    if (!state) return
    const requestedRuntimeServer = runtimeServers.find(
      (server) => server.id === requestedServerId
    )
    if (requestedRuntimeServer && selectedServerId !== requestedServerId) {
      setSelectedServerId(requestedServerId)
      return
    }
    const currentStillExists = runtimeServers.some(
      (server) => server.id === selectedServerId
    )
    if (currentStillExists) return
    const activeRuntimeServer = runtimeServers.find(
      (server) => server.id === state.activeServer?.id
    )
    setSelectedServerId(
      activeRuntimeServer?.id ?? runtimeServers[0]?.id ?? null
    )
  }, [requestedServerId, runtimeServers, selectedServerId, state])

  if (!isDesktop) {
    return (
      <SettingsScreen title="Local Runtime">
        <SettingsSection
          title="About"
          description="The local runtime is bundled with the Electric Agents desktop app. The web build connects to a remote agents-server instead."
        >
          <SettingsPanel>
            <Text size={2} tone="muted">
              Run Electric Agents on your machine to manage the bundled local
              Horton runtime here.
            </Text>
          </SettingsPanel>
        </SettingsSection>
      </SettingsScreen>
    )
  }

  const statusInfo = STATUS_TONES[selectedRuntimeStatus]
  const isRunning = selectedRuntimeStatus === `running`
  const isStarting = selectedRuntimeStatus === `starting`
  const isDisabled = selectedRuntimeStatus === `disabled`
  const canStart = !isRunning && !isStarting

  return (
    <SettingsScreen
      title="Local Runtime"
      action={
        <RuntimeServerSelect
          servers={runtimeServers}
          value={selectedServerId}
          onValueChange={setSelectedServerId}
        />
      }
    >
      <SettingsSection
        title="Status"
        description="The Electron app starts a local Horton runtime in-process so the desktop UI works without an external agents-server."
      >
        <SettingsRow
          label="Runtime"
          description={`The bundled Horton runtime is currently ${statusInfo.label.toLowerCase()}.`}
          control={
            <SettingsStatusBadge tone={statusInfo.tone}>
              {statusInfo.label}
            </SettingsStatusBadge>
          }
        />
        <SettingsRow
          label="Connection"
          description="The runtime connects to the selected agents-server and receives wake events over pull-wake."
          control={
            <Text size={1} family={`mono`} tone={`muted`}>
              {runtimeConnectionLabel(selectedConnection?.runtimeUrl)}
            </Text>
          }
        />
        {selectedConnection?.runtimeError && (
          <SettingsRow
            label="Error"
            control={
              <Text size={1} tone={`danger`}>
                {selectedConnection.runtimeError}
              </Text>
            }
          />
        )}
      </SettingsSection>

      <SettingsSection
        title="Runner"
        description="Live pull-wake runner state synced from the agents-server runners table."
      >
        <SettingsRow
          label="Runner"
          description={runner?.label ?? `Desktop pull-wake runner`}
          control={
            <Text size={1} family="mono" tone="muted">
              {runnerId ?? `-`}
            </Text>
          }
        />
        <SettingsRow
          label="Health"
          description={
            health.issues.length > 0 ? health.issues.join(`, `) : `No issues`
          }
          control={
            <SettingsStatusBadge tone={healthTone.tone}>
              {healthTone.label}
            </SettingsStatusBadge>
          }
        />
        <SettingsRow
          label="Health endpoint"
          description="GET endpoint on the selected agents-server for runner diagnostics."
          wrapControlValue
          splitLayout
          control={
            <Text size={1} family="mono" tone="muted">
              {healthEndpoint ?? `-`}
            </Text>
          }
        />
        <SettingsRow
          label="Stream"
          description={`Offset ${runnerTelemetry?.wake_stream_offset ?? runner?.wake_stream_offset ?? `-`}`}
          control={
            <SettingsStatusBadge
              tone={
                diagnostics?.stream_connected === false
                  ? `warning`
                  : diagnostics?.stream_connected === true
                    ? `success`
                    : `neutral`
              }
            >
              {diagnostics?.stream_connected === false
                ? `Disconnected`
                : diagnostics?.stream_connected === true
                  ? `Connected`
                  : `Unknown`}
            </SettingsStatusBadge>
          }
        />
        <SettingsRow
          label="Last heartbeat"
          description={`Lease expires ${timeLabel(runnerTelemetry?.liveness_lease_expires_at ?? runner?.liveness_lease_expires_at)}`}
          control={
            <Text size={1} tone="muted">
              {timeLabel(runnerTelemetry?.last_seen_at ?? runner?.last_seen_at)}
            </Text>
          }
        />
        <SettingsRow
          label="Activity"
          description={`Last claim ${timeLabel(diagnostics?.last_claim_at)} · last dispatch ${timeLabel(diagnostics?.last_dispatch_at)}`}
          control={
            <Text size={1} family="mono" tone="muted">
              {countLabel(diagnostics?.events_received)} events
            </Text>
          }
        />
        <SettingsRow
          label="Claims"
          description={`Succeeded ${countLabel(diagnostics?.claims_succeeded)} · skipped ${countLabel(diagnostics?.claims_skipped)} · failed ${countLabel(diagnostics?.claims_failed)}`}
          control={
            <SettingsStatusBadge
              tone={diagnostics?.claims_failed ? `danger` : `neutral`}
            >
              {diagnostics?.last_claim_result ?? `none`}
            </SettingsStatusBadge>
          }
        />
        {diagnostics?.last_error && (
          <SettingsRow
            label="Last error"
            description={timeLabel(diagnostics.last_error_at)}
            control={
              <Text size={1} tone="danger">
                {diagnostics.last_error}
              </Text>
            }
          />
        )}
      </SettingsSection>

      <SettingsSection
        title="Controls"
        description="Restart picks up new API keys or other environment changes; stop frees the port if you'd rather connect to a different server."
        actionAlign="description"
        action={
          <Stack direction="row" gap={2}>
            {canStart ? (
              <Button
                variant="solid"
                tone="accent"
                onClick={() =>
                  selectedServer
                    ? void window.electronAPI?.restartServerRuntime?.(
                        selectedServer.id
                      )
                    : undefined
                }
                disabled={!selectedServer || isDisabled}
              >
                <Icon icon={Play} size={2} /> Start runtime
              </Button>
            ) : (
              <Button
                variant="soft"
                tone="neutral"
                onClick={() =>
                  selectedServer
                    ? void window.electronAPI?.restartServerRuntime?.(
                        selectedServer.id
                      )
                    : undefined
                }
                disabled={!selectedServer || isStarting || isDisabled}
              >
                <Icon icon={RefreshCw} size={2} /> Restart runtime
              </Button>
            )}
            <Button
              variant="soft"
              tone="neutral"
              onClick={() =>
                selectedServer
                  ? void window.electronAPI?.stopServerRuntime?.(
                      selectedServer.id
                    )
                  : undefined
              }
              disabled={!selectedServer || (!isRunning && !isStarting)}
            >
              <Icon icon={Square} size={2} /> Stop runtime
            </Button>
          </Stack>
        }
      />
    </SettingsScreen>
  )
}

function RuntimeServerSelect({
  servers,
  value,
  onValueChange,
}: {
  servers: Array<ServerConfig>
  value: string | null
  onValueChange: (value: string | null) => void
}): React.ReactElement {
  const labelById = useMemo(
    () => new Map(servers.map((server) => [server.id, server.name])),
    [servers]
  )
  return (
    <Select.Root value={value} onValueChange={onValueChange}>
      <Select.Trigger
        placeholder="No local runtimes"
        renderValue={(selected) =>
          selected ? (labelById.get(selected) ?? selected) : `No local runtimes`
        }
        style={{ minWidth: 220 }}
      />
      <Select.Content>
        {servers.map((server) => (
          <Select.Item key={server.id} value={server.id}>
            {server.name}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  )
}
