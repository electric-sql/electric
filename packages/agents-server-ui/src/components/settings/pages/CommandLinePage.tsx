import { useEffect, useState } from 'react'
import { RefreshCw, Terminal, Trash2 } from 'lucide-react'
import { Button, Icon, Text } from '../../../ui'
import {
  installCli,
  loadCliStatus,
  uninstallCli,
  type ElectricCliStatus,
} from '../../../lib/server-connection'
import {
  SettingsActions,
  SettingsPanel,
  SettingsRow,
  SettingsScreen,
  SettingsSection,
  SettingsStatusBadge,
  type SettingsStatusTone,
} from '../SettingsScreen'

const STATUS_LABELS: Record<
  ElectricCliStatus[`kind`],
  { label: string; tone: SettingsStatusTone }
> = {
  'not-installed': { label: `Not installed`, tone: `neutral` },
  managed: { label: `Managed`, tone: `success` },
  manual: { label: `Self-managed`, tone: `info` },
  shadowed: { label: `Shadowed`, tone: `warning` },
  broken: { label: `Needs repair`, tone: `danger` },
}

export function CommandLinePage(): React.ReactElement {
  const isDesktop = typeof window !== `undefined` && Boolean(window.electronAPI)
  const [status, setStatus] = useState<ElectricCliStatus | null>(null)
  const [busy, setBusy] = useState<`refresh` | `install` | `uninstall` | null>(
    null
  )
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    setBusy(`refresh`)
    setError(null)
    try {
      setStatus(await loadCliStatus())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    if (!isDesktop) return
    void refresh()
  }, [isDesktop])

  const run = (action: `install` | `uninstall`) => async () => {
    setBusy(action)
    setError(null)
    try {
      setStatus(
        action === `install` ? await installCli() : await uninstallCli()
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  if (!isDesktop) {
    return (
      <SettingsScreen title="Command Line">
        <SettingsSection title="About">
          <SettingsPanel>
            <Text size={2} tone="muted">
              Command line tool management is only available in the desktop app.
            </Text>
          </SettingsPanel>
        </SettingsSection>
      </SettingsScreen>
    )
  }

  const info = status ? STATUS_LABELS[status.kind] : null
  const canInstall =
    status?.kind === `not-installed` || status?.kind === `broken`
  const canUninstall = status?.managedPath !== null

  return (
    <SettingsScreen
      title="Command Line"
      action={
        <Button
          variant="soft"
          tone="neutral"
          size={2}
          disabled={busy !== null}
          onClick={() => {
            void refresh()
          }}
        >
          <Icon icon={RefreshCw} size={2} />
          Refresh
        </Button>
      }
    >
      <SettingsSection
        title="Electric CLI"
        description="Install and inspect the electric command used from your terminal."
      >
        <SettingsRow
          label={
            <span
              style={{ display: `inline-flex`, alignItems: `center`, gap: 8 }}
            >
              <Icon icon={Terminal} size={2} />
              Status
            </span>
          }
          description={statusDescription(status)}
          control={
            info ? (
              <SettingsStatusBadge tone={info.tone}>
                {info.label}
              </SettingsStatusBadge>
            ) : (
              <Text size={2} tone="muted">
                Loading…
              </Text>
            )
          }
        />
        {status && (
          <>
            <SettingsRow
              label="Resolved command"
              description={status.path ?? `No electric command found on PATH.`}
              control={
                <Text size={2} tone="muted" family="mono">
                  {status.version ?? `-`}
                </Text>
              }
              wrapControlValue
            />
            <SettingsRow
              label="Bundled version"
              description={`This desktop app includes electric ${status.bundledVersion}.`}
              control={
                <Text size={2} tone="muted" family="mono">
                  {status.bundledVersion}
                </Text>
              }
            />
            <SettingsRow
              label="Install location"
              description={
                status.installDirOnPath
                  ? status.installDir
                  : `${status.installDir} is not on PATH.`
              }
              control={
                <SettingsStatusBadge
                  tone={status.installDirOnPath ? `success` : `warning`}
                >
                  {status.installDirOnPath ? `On PATH` : `Not on PATH`}
                </SettingsStatusBadge>
              }
              wrapControlValue
            />
          </>
        )}
        {(error || status?.error) && (
          <SettingsPanel>
            <Text size={2} tone="danger">
              {error ?? status?.error}
            </Text>
          </SettingsPanel>
        )}
        <SettingsActions separator>
          <Button
            variant="solid"
            tone="accent"
            size={2}
            disabled={!status || !canInstall || busy !== null}
            onClick={() => {
              void run(`install`)()
            }}
          >
            {busy === `install`
              ? `Installing…`
              : status?.kind === `broken`
                ? `Repair command`
                : `Install command`}
          </Button>
          <Button
            variant="soft"
            tone="danger"
            size={2}
            disabled={!status || !canUninstall || busy !== null}
            onClick={() => {
              void run(`uninstall`)()
            }}
          >
            <Icon icon={Trash2} size={2} />
            {busy === `uninstall`
              ? `Uninstalling…`
              : `Uninstall managed command`}
          </Button>
        </SettingsActions>
      </SettingsSection>
    </SettingsScreen>
  )
}

function statusDescription(status: ElectricCliStatus | null): string {
  if (!status) return `Checking for the electric command.`
  switch (status.kind) {
    case `managed`:
      return `The electric command is installed and managed by Electric Agents Desktop.`
    case `manual`:
      return `A self-managed electric command was found. Electric Agents Desktop will not overwrite it.`
    case `shadowed`:
      return `A desktop-managed command exists, but another electric command appears earlier on PATH.`
    case `broken`:
      return `The desktop-managed command exists but could not run.`
    case `not-installed`:
      return `Install the electric command from the CLI bundled with this desktop app.`
  }
}
