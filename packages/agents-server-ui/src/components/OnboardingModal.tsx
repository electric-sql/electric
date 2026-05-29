import { useEffect, useMemo, useRef, useState } from 'react'
import { Accordion } from '@base-ui/react/accordion'
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Cloud,
  ExternalLink,
  Eye,
  EyeOff,
  Github,
  Laptop,
  LogIn,
  Plug,
  Server,
  Sparkles,
  Terminal,
} from 'lucide-react'
import {
  codexEnableSource,
  codexSignIn,
  cloudOpenCreateAgentsServer,
  cloudSignIn,
  loadApiKeysStatus,
  loadCloudAuthState,
  loadDesktopState,
  installCli,
  loadLaunchAtLoginStatus,
  loadOnboardingState,
  loadCliStatus,
  onCloudAuthStateChanged,
  prepareCloudAgentServerConnection,
  restartLocalRuntimes,
  saveApiKeys as persistApiKeys,
  setLaunchAtLogin,
  setOnboardingDismissed,
  type ApiKeys,
  type ApiKeysStatus,
  type CloudAuthState,
  type ConnectServerOptions,
  type CodexAuthSource,
  type CodexStatus,
  type ElectricCliStatus,
  type LaunchAtLoginStatus,
} from '../lib/server-connection'
import {
  useAvailableServers,
  type AvailableServer,
} from '../hooks/useAvailableServers'
import { useServerConnection } from '../hooks/useServerConnection'
import {
  Button,
  Dialog,
  Icon,
  IconButton,
  Input,
  Link,
  Switch,
  Text,
} from '../ui'
import styles from './OnboardingModal.module.css'

type Step = `cloud` | `keys` | `config` | `server`

const BASE_STEPS: ReadonlyArray<{ id: Step; label: string }> = [
  { id: `cloud`, label: `Cloud` },
  { id: `keys`, label: `Models` },
  { id: `config`, label: `Config` },
  { id: `server`, label: `Server` },
]

type ProviderId = keyof ApiKeys

type ProviderKind = `model` | `tool`

const MODEL_PROVIDER_IDS: ReadonlyArray<ProviderId> = [
  `anthropic`,
  `openai`,
  `deepseek`,
]

const MODEL_PROVIDERS: ReadonlyArray<{
  id: ProviderId
  name: string
  description: string
  placeholder: string
  kind: ProviderKind
}> = [
  {
    id: `anthropic`,
    name: `Anthropic API`,
    description: `Claude models — the default for the local runtime.`,
    placeholder: `sk-ant-…`,
    kind: `model`,
  },
  {
    id: `openai`,
    name: `OpenAI API`,
    description: `GPT models, including the GPT-5 family.`,
    placeholder: `sk-…`,
    kind: `model`,
  },
  {
    id: `deepseek`,
    name: `DeepSeek API`,
    description: `DeepSeek's hosted reasoning models.`,
    placeholder: `sk-…`,
    kind: `model`,
  },
]

const TOOL_PROVIDERS: ReadonlyArray<{
  id: ProviderId
  name: string
  description: string
  placeholder: string
  kind: ProviderKind
}> = [
  {
    id: `brave`,
    name: `Brave Search API`,
    description: `Adds the brave_search tool. Without it, agents fall back to Anthropic's built-in search.`,
    placeholder: `BSA…`,
    kind: `tool`,
  },
]

/**
 * First-launch onboarding wizard for the Electron desktop app.
 *
 * Three steps with visuals matching the Settings shell: section
 * headings sit above bordered card surfaces (1px border + radius +
 * tinted background) with their rows separated by 1px borders. The
 * API keys step is rendered as a base-ui Accordion so only one
 * provider is editable at a time.
 */
export function OnboardingModal(): React.ReactElement | null {
  const isDesktop = typeof window !== `undefined` && Boolean(window.electronAPI)
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>(`cloud`)
  const [cloudState, setCloudState] = useState<CloudAuthState | null>(null)
  const [keysStatus, setKeysStatus] = useState<ApiKeysStatus | null>(null)
  const [launchAtLoginStatus, setLaunchAtLoginStatus] =
    useState<LaunchAtLoginStatus | null>(null)
  const [cliStatus, setCliStatus] = useState<ElectricCliStatus | null>(null)
  const [launchAtLoginEnabled, setLaunchAtLoginEnabled] = useState(false)
  const [bootstrapped, setBootstrapped] = useState(false)
  const configAvailable = launchAtLoginStatus?.supported === true
  const steps = useMemo(
    () =>
      configAvailable
        ? BASE_STEPS
        : BASE_STEPS.filter((candidate) => candidate.id !== `config`),
    [configAvailable]
  )

  useEffect(() => {
    if (!isDesktop) return
    let cancelled = false

    void (async () => {
      const [onboarding, cloud, keys, launchAtLogin, cli] = await Promise.all([
        loadOnboardingState(),
        loadCloudAuthState(),
        loadApiKeysStatus(),
        loadLaunchAtLoginStatus(),
        loadCliStatus(),
      ])
      if (cancelled) return
      setCloudState(cloud)
      setKeysStatus(keys)
      setLaunchAtLoginStatus(launchAtLogin)
      setCliStatus(cli)
      setLaunchAtLoginEnabled(launchAtLogin?.enabled ?? false)
      setBootstrapped(true)

      if (!onboarding || onboarding.dismissed) return
      setStep(
        onboarding.signedIn
          ? onboarding.hasAnyKey
            ? launchAtLogin?.supported
              ? `config`
              : `server`
            : `keys`
          : `cloud`
      )
      setOpen(true)
    })()

    const unsubscribe = onCloudAuthStateChanged((next) => {
      setCloudState(next)
    })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [isDesktop])

  useEffect(() => {
    if (!open) return
    if (step !== `cloud`) return
    if (cloudState?.status === `signed-in`) setStep(`keys`)
  }, [open, step, cloudState?.status])

  // Credential changes made inside onboarding (API keys, Codex sign-in,
  // detected-source approval) defer the runtime restart to a single
  // explicit step at completion — same model as the Credentials
  // settings page banner. We restart only when there's something to
  // restart, so first-launch (where no runtime is running yet) stays
  // a no-op and the Server step's `connectServer` starts the runtime
  // with the right env on its first launch. Wired into the dialog's
  // `onOpenChange` so escape / backdrop dismissals also flush.
  const applyPendingRestart = useMemo(
    () => async () => {
      const desktopState = await loadDesktopState()
      if (desktopState?.credentialsRestartPending) {
        await restartLocalRuntimes()
      }
    },
    []
  )

  const closeModal = useMemo(
    () => async () => {
      await setOnboardingDismissed(true)
      setOpen(false)
    },
    []
  )

  const dismissForever = useMemo(
    () => () => {
      void setOnboardingDismissed(true)
      setOpen(false)
    },
    []
  )

  if (!isDesktop) return null
  if (!bootstrapped) return null
  if (!keysStatus) return null

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        // Any close path (escape, backdrop click, programmatic) should
        // also flush a pending credential restart so the user never
        // ends up with a running runtime that's out of sync with their
        // saved keys.
        if (!next) void applyPendingRestart()
        setOpen(next)
      }}
    >
      <Dialog.Content maxWidth={640} className={styles.content}>
        <StepIndicator step={step} steps={steps} />
        <div className={styles.body}>
          {step === `cloud` && (
            <CloudStep
              cloudState={cloudState}
              onContinue={() => setStep(`keys`)}
              onDismissForever={dismissForever}
            />
          )}
          {step === `keys` && (
            <KeysStep
              keysStatus={keysStatus}
              onKeysStatusChange={setKeysStatus}
              onBack={() => setStep(`cloud`)}
              onContinue={() => setStep(configAvailable ? `config` : `server`)}
            />
          )}
          {step === `config` && configAvailable && (
            <ConfigStep
              launchAtLoginEnabled={launchAtLoginEnabled}
              onLaunchAtLoginEnabledChange={setLaunchAtLoginEnabled}
              cliStatus={cliStatus}
              onCliStatusChange={setCliStatus}
              onBack={() => setStep(`keys`)}
              onContinue={() => setStep(`server`)}
            />
          )}
          {step === `server` && (
            <ServerStep
              cloudState={cloudState}
              onBack={() => setStep(configAvailable ? `config` : `keys`)}
              applyLaunchAtLogin={configAvailable}
              launchAtLoginEnabled={launchAtLoginEnabled}
              onFinish={() => {
                void closeModal()
              }}
            />
          )}
        </div>
      </Dialog.Content>
    </Dialog.Root>
  )
}

function ConfigStep({
  launchAtLoginEnabled,
  onLaunchAtLoginEnabledChange,
  cliStatus,
  onCliStatusChange,
  onBack,
  onContinue,
}: {
  launchAtLoginEnabled: boolean
  onLaunchAtLoginEnabledChange: (enabled: boolean) => void
  cliStatus: ElectricCliStatus | null
  onCliStatusChange: (status: ElectricCliStatus | null) => void
  onBack: () => void
  onContinue: () => void
}): React.ReactElement {
  const [cliBusy, setCliBusy] = useState(false)
  const [cliError, setCliError] = useState<string | null>(null)
  const installCommand = async () => {
    setCliBusy(true)
    setCliError(null)
    try {
      onCliStatusChange(await installCli())
    } catch (error) {
      setCliError(error instanceof Error ? error.message : String(error))
    } finally {
      setCliBusy(false)
    }
  }
  const cliInstalled =
    cliStatus?.kind === `managed` ||
    cliStatus?.kind === `manual` ||
    cliStatus?.kind === `shadowed`
  const cliDescription =
    cliError ??
    cliStatus?.error ??
    (cliStatus?.kind === `manual`
      ? `Found a self-managed electric command at ${cliStatus.path}.`
      : cliStatus?.kind === `managed`
        ? `The electric command is installed and managed by Electric Agents Desktop.`
        : cliStatus?.kind === `shadowed`
          ? `A desktop-managed command exists, but another electric command appears first on PATH.`
          : cliStatus && !cliStatus.installDirOnPath
            ? `${cliStatus.installDir} is not on PATH.`
            : `Adds the electric command to your terminal using the CLI bundled with this app.`)

  return (
    <>
      <StepHeader
        title="Config"
        description="Choose how Electric Agents should run on this machine."
      />
      <Section>
        <SectionRow>
          <span className={styles.iconCircle}>
            <Icon icon={LogIn} size={2} />
          </span>
          <label className={styles.rowText} style={{ cursor: `pointer` }}>
            <span className={styles.rowTitle}>Open at login</span>
            <Text size={1} tone="muted">
              Start Electric Agents when you sign in and keep it available from
              the system tray.
            </Text>
          </label>
          <span className={styles.rowAside}>
            <Switch
              checked={launchAtLoginEnabled}
              onCheckedChange={onLaunchAtLoginEnabledChange}
              ariaLabel="Open Electric Agents at login"
            />
          </span>
        </SectionRow>
        <SectionRow>
          <span className={styles.iconCircle}>
            <Icon icon={Terminal} size={2} />
          </span>
          <div className={styles.rowText}>
            <span className={styles.rowTitle}>Electric CLI</span>
            <Text size={1} tone={cliError ? `danger` : `muted`}>
              {cliDescription}
            </Text>
          </div>
          <span className={styles.rowAside}>
            <Button
              type="button"
              variant="soft"
              tone="neutral"
              size={2}
              disabled={
                cliBusy ||
                !cliStatus ||
                cliStatus.kind === `manual` ||
                cliStatus.kind === `managed` ||
                cliStatus.kind === `shadowed`
              }
              onClick={() => {
                void installCommand()
              }}
            >
              {cliBusy
                ? `Installing…`
                : cliInstalled
                  ? `Installed`
                  : cliStatus?.kind === `broken`
                    ? `Repair`
                    : `Install command`}
            </Button>
          </span>
        </SectionRow>
      </Section>
      <Footer
        leading={
          <Button
            type="button"
            variant="ghost"
            tone="neutral"
            size={2}
            onClick={onBack}
          >
            Back
          </Button>
        }
        trailing={
          <Button
            type="button"
            variant="solid"
            tone="accent"
            size={2}
            onClick={onContinue}
          >
            Continue
            <Icon icon={ArrowRight} size={2} />
          </Button>
        }
      />
    </>
  )
}

function CloudStep({
  cloudState,
  onContinue,
  onDismissForever,
}: {
  cloudState: CloudAuthState | null
  onContinue: () => void
  onDismissForever: () => void
}): React.ReactElement {
  const cloudStatus = cloudState?.status ?? `signed-out`
  const cloudSigningIn = cloudStatus === `signing-in`
  const cloudSignedIn = cloudStatus === `signed-in`

  return (
    <>
      <StepHeader
        title="Electric Cloud"
        description="The data platform for multi-agent systems. Sign in to discover hosted agents servers, provision new ones, and connect this desktop app to your Electric Cloud workspaces."
      />
      {cloudSignedIn ? (
        <div className={styles.signedIn}>
          <span className={styles.iconCircle} data-tone="success">
            <Icon icon={CheckCircle2} size={2} />
          </span>
          <div className={styles.rowText}>
            <span className={styles.rowTitle}>
              {cloudState?.name ?? `Signed in`}
            </span>
            {cloudState?.email && (
              <Text size={1} tone="muted">
                {cloudState.email}
              </Text>
            )}
          </div>
        </div>
      ) : (
        <div className={styles.cloudSignIn}>
          <div className={styles.providerButtons}>
            <Button
              variant="solid"
              tone="neutral"
              size={3}
              disabled={cloudSigningIn}
              onClick={() => {
                void cloudSignIn(`github`)
              }}
            >
              <Icon icon={Github} size={2} />
              Sign in with GitHub
            </Button>
            <Button
              variant="soft"
              tone="neutral"
              size={3}
              disabled={cloudSigningIn}
              onClick={() => {
                void cloudSignIn(`google`)
              }}
            >
              Sign in with Google
            </Button>
          </div>
          <div className={styles.cloudFinePrintStack}>
            <Text size={1} tone="muted" className={styles.cloudFinePrint}>
              Opens dashboard.electric-sql.cloud in a sign-in window. It closes
              automatically once you've authorized.
            </Text>
            <Text size={1} tone="muted" className={styles.cloudFinePrint}>
              By signing in, you agree to our{` `}
              <Link
                size={1}
                href="https://electric.ax/about/legal/terms"
                target="_blank"
                rel="noreferrer"
                className={styles.finePrintLink}
              >
                terms of service
              </Link>
              {` `}and{` `}
              <Link
                size={1}
                href="https://electric.ax/about/legal/privacy"
                target="_blank"
                rel="noreferrer"
                className={styles.finePrintLink}
              >
                privacy policy
              </Link>
              .
            </Text>
          </div>
          {cloudState?.error && (
            <Text size={2} tone="danger">
              {cloudState.error}
            </Text>
          )}
        </div>
      )}
      <Footer
        leading={
          <button
            type="button"
            className={styles.footerLink}
            onClick={onDismissForever}
          >
            Don't show this again
          </button>
        }
        trailing={
          <Button
            type="button"
            variant="solid"
            tone="accent"
            size={2}
            onClick={onContinue}
          >
            {cloudSignedIn ? `Continue` : `Continue without Cloud`}
            <Icon icon={ArrowRight} size={2} />
          </Button>
        }
      />
    </>
  )
}

function KeysStep({
  keysStatus,
  onKeysStatusChange,
  onBack,
  onContinue,
}: {
  keysStatus: ApiKeysStatus
  onKeysStatusChange: (status: ApiKeysStatus) => void
  onBack: () => void
  onContinue: () => void
}): React.ReactElement {
  const hasAnySuggestion = [...MODEL_PROVIDERS, ...TOOL_PROVIDERS].some(
    (provider) => Boolean(keysStatus.suggested[provider.id])
  )
  const hasAnyModelKey =
    MODEL_PROVIDER_IDS.some((id) => Boolean(keysStatus.saved[id])) ||
    keysStatus.codex.enabled

  const refreshStatus = async () => {
    const next = await loadApiKeysStatus()
    if (next) onKeysStatusChange(next)
  }

  return (
    <>
      <StepHeader
        title="Add model providers"
        description="All providers are optional — but to run agents in the bundled local runtime you'll need at least one model provider, such as an API key or ChatGPT / Codex sign-in. Credentials and consent are stored on this machine and can be changed anytime in Settings."
      />
      {hasAnySuggestion && !hasAnyModelKey && (
        <div className={styles.hint}>
          <Icon icon={Sparkles} size={2} />
          <Text size={1} tone="muted">
            We found provider keys in your environment. Open a row to review and
            save it.
          </Text>
        </div>
      )}
      <Accordion.Root className={styles.section} multiple>
        <CodexProviderItem codex={keysStatus.codex} onSaved={refreshStatus} />
        {MODEL_PROVIDERS.map((provider) => (
          <ProviderItem
            key={provider.id}
            provider={provider}
            keysStatus={keysStatus}
            onSaved={refreshStatus}
          />
        ))}
      </Accordion.Root>
      <SectionHeader
        title="Optional tools"
        description="Tools extend local agents but do not count as model providers."
      />
      <Accordion.Root className={styles.section} multiple>
        {TOOL_PROVIDERS.map((provider) => (
          <ProviderItem
            key={provider.id}
            provider={provider}
            keysStatus={keysStatus}
            onSaved={refreshStatus}
          />
        ))}
      </Accordion.Root>
      <Footer
        leading={
          <Button
            type="button"
            variant="ghost"
            tone="neutral"
            size={2}
            onClick={onBack}
          >
            Back
          </Button>
        }
        trailing={
          <Button
            type="button"
            variant="solid"
            tone="accent"
            size={2}
            onClick={onContinue}
          >
            {hasAnyModelKey ? `Continue` : `Skip for now`}
            <Icon icon={ArrowRight} size={2} />
          </Button>
        }
      />
    </>
  )
}

function CodexProviderItem({
  codex,
  onSaved,
}: {
  codex: CodexStatus
  onSaved: () => Promise<void>
}): React.ReactElement {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const available = codex.availableSources.filter(
    (source) => source.source !== `desktop-oauth` || !codex.enabled
  )

  const useSource = async (source: CodexAuthSource) => {
    setBusy(source)
    setError(null)
    try {
      await codexEnableSource(source)
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const signIn = async () => {
    setBusy(`sign-in`)
    setError(null)
    try {
      await codexSignIn()
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Accordion.Item value="codex" className={styles.accordionItem}>
      <Accordion.Header className={styles.accordionHeader}>
        <Accordion.Trigger className={styles.accordionTrigger}>
          <span className={styles.rowText}>
            <span className={styles.rowTitleLine}>
              <span className={styles.rowTitle}>ChatGPT / Codex</span>
              <span className={styles.kindTag} data-kind="model" aria-hidden>
                Model
              </span>
            </span>
            <Text size={1} tone="muted">
              Use ChatGPT / Codex models after explicit approval or sign-in.
            </Text>
          </span>
          <span className={styles.rowAside}>
            {codex.enabled ? (
              <span className={styles.statusConfigured}>
                <Icon icon={CheckCircle2} size={1} />
                Enabled
              </span>
            ) : available.length > 0 ? (
              <span className={styles.statusSuggested}>
                <Icon icon={Sparkles} size={1} />
                Login found
              </span>
            ) : (
              <span className={styles.statusEmpty}>Not set</span>
            )}
            <span className={styles.chevron} aria-hidden>
              <Icon icon={ChevronDown} size={2} />
            </span>
          </span>
        </Accordion.Trigger>
      </Accordion.Header>
      <Accordion.Panel className={styles.accordionPanel}>
        <div className={styles.accordionPanelInner}>
          <div className={styles.codexActions}>
            {codex.enabled ? (
              <Text size={2} tone="muted">
                ChatGPT / Codex is enabled for this desktop runtime.
              </Text>
            ) : available.length > 0 ? (
              <>
                <Text size={2} tone="muted">
                  We found a local ChatGPT / Codex login. Electric Agents will
                  only use it if you approve it.
                </Text>
                {available.map((source) => (
                  <Button
                    key={source.source}
                    type="button"
                    variant="soft"
                    tone="neutral"
                    size={2}
                    disabled={busy !== null}
                    onClick={() => {
                      void useSource(source.source)
                    }}
                  >
                    {busy === source.source
                      ? `Enabling…`
                      : `Use ${source.label}`}
                  </Button>
                ))}
              </>
            ) : (
              <Text size={2} tone="muted">
                No local ChatGPT / Codex login was found. Sign in with OpenAI to
                enable Codex models.
              </Text>
            )}
            <Button
              type="button"
              size={2}
              disabled={busy !== null}
              onClick={() => {
                void signIn()
              }}
            >
              {busy === `sign-in`
                ? `Signing in…`
                : `Sign in to ChatGPT / Codex`}
            </Button>
            {error && (
              <Text size={2} tone="danger">
                {error}
              </Text>
            )}
          </div>
        </div>
      </Accordion.Panel>
    </Accordion.Item>
  )
}

function ProviderItem({
  provider,
  keysStatus,
  onSaved,
}: {
  provider: (typeof MODEL_PROVIDERS | typeof TOOL_PROVIDERS)[number]
  keysStatus: ApiKeysStatus
  onSaved: () => Promise<void>
}): React.ReactElement {
  const saved = keysStatus.saved[provider.id]
  const suggested = keysStatus.suggested[provider.id]
  const isConfigured = Boolean(saved)
  const initialValue = saved ?? suggested ?? ``

  const [value, setValue] = useState(initialValue)
  const [visible, setVisible] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const savingRef = useRef(false)

  // Keep local value in sync with parent state (e.g. after persist).
  useEffect(() => {
    setValue(initialValue)
  }, [initialValue])

  const persistIfDirty = async () => {
    if (savingRef.current) return
    const trimmed = value.trim()
    const next = trimmed.length > 0 ? trimmed : null
    const current = saved ?? null
    if (next === current) return

    savingRef.current = true
    try {
      const nextKeys: ApiKeys = {
        anthropic: keysStatus.saved.anthropic ?? null,
        openai: keysStatus.saved.openai ?? null,
        deepseek: keysStatus.saved.deepseek ?? null,
        brave: keysStatus.saved.brave ?? null,
        [provider.id]: next,
      }
      await persistApiKeys(nextKeys)
      await onSaved()
      setSavedFlash(true)
      window.setTimeout(() => setSavedFlash(false), 1600)
    } finally {
      savingRef.current = false
    }
  }

  return (
    <Accordion.Item value={provider.id} className={styles.accordionItem}>
      <Accordion.Header className={styles.accordionHeader}>
        <Accordion.Trigger className={styles.accordionTrigger}>
          <span className={styles.rowText}>
            <span className={styles.rowTitleLine}>
              <span className={styles.rowTitle}>{provider.name}</span>
              <span
                className={styles.kindTag}
                data-kind={provider.kind}
                aria-hidden
              >
                {provider.kind === `model` ? `Model` : `Tool`}
              </span>
            </span>
            <Text size={1} tone="muted">
              {provider.description}
            </Text>
          </span>
          <span className={styles.rowAside}>
            {savedFlash ? (
              <span className={styles.statusConfigured}>
                <Icon icon={CheckCircle2} size={1} />
                Saved
              </span>
            ) : isConfigured ? (
              <span className={styles.statusConfigured}>
                <Icon icon={CheckCircle2} size={1} />
                Configured
              </span>
            ) : suggested ? (
              <span className={styles.statusSuggested}>
                <Icon icon={Sparkles} size={1} />
                From environment
              </span>
            ) : (
              <span className={styles.statusEmpty}>Not set</span>
            )}
            <span className={styles.chevron} aria-hidden>
              <Icon icon={ChevronDown} size={2} />
            </span>
          </span>
        </Accordion.Trigger>
      </Accordion.Header>
      <Accordion.Panel className={styles.accordionPanel}>
        <div className={styles.accordionPanelInner}>
          <div className={styles.secretInput}>
            <Input
              type={visible ? `text` : `password`}
              placeholder={provider.placeholder}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={() => {
                void persistIfDirty()
              }}
              size={2}
              mono
              autoFocus
              className={styles.secretInputControl}
              onKeyDown={(event) => {
                if (event.key === `Enter`) {
                  event.preventDefault()
                  ;(event.currentTarget as HTMLInputElement).blur()
                }
              }}
            />
            <IconButton
              type="button"
              variant="ghost"
              tone="neutral"
              size={1}
              aria-label={visible ? `Hide API key` : `Show API key`}
              className={styles.secretInputToggle}
              onClick={() => setVisible((v) => !v)}
            >
              <Icon icon={visible ? EyeOff : Eye} size={2} />
            </IconButton>
          </div>
        </div>
      </Accordion.Panel>
    </Accordion.Item>
  )
}

function ServerStep({
  cloudState,
  onBack,
  applyLaunchAtLogin,
  launchAtLoginEnabled,
  onFinish,
}: {
  cloudState: CloudAuthState | null
  onBack: () => void
  applyLaunchAtLogin: boolean
  launchAtLoginEnabled: boolean
  onFinish: () => void | Promise<void>
}): React.ReactElement {
  const { servers } = useAvailableServers()
  const { addServer, connectServer, setActiveServer } = useServerConnection()
  const [serverError, setServerError] = useState<string | null>(null)
  const [connectingKey, setConnectingKey] = useState<string | null>(null)
  const cloudSignedIn = cloudState?.status === `signed-in`

  const finish = async (): Promise<void> => {
    setServerError(null)
    if (applyLaunchAtLogin) {
      try {
        const status = await setLaunchAtLogin(launchAtLoginEnabled)
        if (status && !status.supported) {
          setServerError(status.reason ?? `Open at login is not supported.`)
          return
        }
      } catch (error) {
        setServerError(
          error instanceof Error
            ? error.message
            : `Could not enable open at login.`
        )
        return
      }
    }
    await onFinish()
  }

  const connectAvailableServer = async (item: AvailableServer) => {
    setServerError(null)
    setConnectingKey(item.key)
    const options: ConnectServerOptions = { localRuntimeEnabled: true }
    try {
      if (item.server) {
        setActiveServer(item.server)
        connectServer(item.server.id, options)
        await finish()
        return
      }

      if (item.cloudServer) {
        const result = await prepareCloudAgentServerConnection(
          item.cloudServer.id
        )
        if (!result) throw new Error(`Could not prepare the cloud connection.`)
        addServer(
          {
            name: item.cloudServer.name,
            url: result.url,
            source: `electric-cloud`,
            desiredState: `connected`,
            localRuntimeEnabled: true,
            tenantId: result.tenantId,
          },
          options
        )
        await finish()
        return
      }

      if (item.discoveredServer) {
        addServer(
          {
            name: item.name,
            url: item.discoveredServer.url,
            source: `local-discovery`,
            desiredState: `connected`,
            localRuntimeEnabled: true,
          },
          options
        )
        await finish()
      }
    } catch (error) {
      setServerError(
        error instanceof Error ? error.message : `Connection failed`
      )
    } finally {
      setConnectingKey(null)
    }
  }

  return (
    <>
      <StepHeader
        title="Choose your first server"
        description="Pick the agents server this app should connect to. Local connections start the bundled runtime automatically."
      />
      {servers.length > 0 ? (
        <Section>
          {servers.map((item) => (
            <OnboardingServerRow
              key={item.key}
              item={item}
              connecting={connectingKey === item.key}
              onSelect={() => {
                void connectAvailableServer(item)
              }}
            />
          ))}
        </Section>
      ) : (
        <Section>
          <SectionRow>
            <span className={styles.iconCircle}>
              <Icon icon={Server} size={2} />
            </span>
            <div className={styles.rowText}>
              <Text size={2} tone="muted">
                No servers found yet. Create a hosted one in Electric Cloud
                below, or add a local or self-hosted server later from Settings.
              </Text>
            </div>
          </SectionRow>
        </Section>
      )}
      {serverError && (
        <Text size={2} tone="danger">
          {serverError}
        </Text>
      )}
      <SectionHeader
        title="Electric Cloud"
        description={
          cloudSignedIn
            ? `Provision a new hosted agents server from the dashboard.`
            : `Sign in to Electric Cloud to provision a hosted agents server.`
        }
        action={
          <Button
            type="button"
            variant="solid"
            tone="accent"
            size={2}
            disabled={!cloudSignedIn}
            onClick={() => {
              void cloudOpenCreateAgentsServer()
            }}
          >
            <Icon icon={ExternalLink} size={2} />
            Create server
          </Button>
        }
      />
      <Footer
        leading={
          <Button
            type="button"
            variant="ghost"
            tone="neutral"
            size={2}
            onClick={onBack}
          >
            Back
          </Button>
        }
        trailing={
          <Button
            type="button"
            variant="ghost"
            tone="neutral"
            size={2}
            onClick={() => {
              void finish()
            }}
          >
            Skip for now
          </Button>
        }
      />
    </>
  )
}

function OnboardingServerRow({
  item,
  connecting,
  onSelect,
}: {
  item: AvailableServer
  connecting: boolean
  onSelect: () => void
}): React.ReactElement {
  const KindIcon = item.isCloud ? Cloud : item.isLocal ? Laptop : Plug
  const meta = item.isCloud ? item.cloudPath : (item.url ?? item.description)
  return (
    <button
      type="button"
      className={styles.serverRow}
      onClick={onSelect}
      disabled={connecting}
    >
      <span className={styles.iconCircle}>
        <Icon icon={KindIcon} size={2} />
      </span>
      <span className={styles.rowText}>
        <span className={styles.rowTitle}>{item.name}</span>
        {meta && (
          <Text size={1} tone="muted" className={styles.rowMeta}>
            {meta}
          </Text>
        )}
      </span>
      <span className={styles.rowAside}>
        {connecting ? (
          <Text size={1} tone="muted">
            Connecting…
          </Text>
        ) : (
          <span className={styles.serverChevron}>
            <Icon icon={ArrowRight} size={2} />
          </span>
        )}
      </span>
    </button>
  )
}

/* ── Layout primitives (local to onboarding) ───────────────── */

function Section({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  return <div className={styles.section}>{children}</div>
}

function SectionRow({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  return <div className={styles.sectionRow}>{children}</div>
}

function SectionHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}): React.ReactElement {
  return (
    <div className={styles.sectionHeader}>
      <div className={styles.sectionHeaderText}>
        <h3 className={styles.sectionHeaderTitle}>{title}</h3>
        {description && (
          <Text size={1} tone="muted">
            {description}
          </Text>
        )}
      </div>
      {action && <div className={styles.sectionHeaderAction}>{action}</div>}
    </div>
  )
}

function StepHeader({
  title,
  description,
}: {
  title: string
  description: string
}): React.ReactElement {
  return (
    <div className={styles.stepHeader}>
      <Dialog.Title>{title}</Dialog.Title>
      <Dialog.Description>{description}</Dialog.Description>
    </div>
  )
}

function Footer({
  leading,
  trailing,
}: {
  leading: React.ReactNode
  trailing: React.ReactNode
}): React.ReactElement {
  return (
    <div className={styles.footer}>
      <div className={styles.footerLeading}>{leading}</div>
      <div className={styles.footerTrailing}>{trailing}</div>
    </div>
  )
}

function StepIndicator({
  step,
  steps,
}: {
  step: Step
  steps: ReadonlyArray<{ id: Step; label: string }>
}): React.ReactElement {
  const activeIndex = steps.findIndex((candidate) => candidate.id === step)

  return (
    <div className={styles.steps} aria-label="Onboarding progress">
      {steps.map((candidate, index) => {
        const active = candidate.id === step
        const complete = index < activeIndex
        return (
          <div
            key={candidate.id}
            className={[
              styles.step,
              active ? styles.stepActive : ``,
              complete ? styles.stepComplete : ``,
            ]
              .filter(Boolean)
              .join(` `)}
            aria-current={active ? `step` : undefined}
          >
            <span className={styles.stepNumber}>
              {complete ? <Icon icon={CheckCircle2} size={2} /> : index + 1}
            </span>
            <span className={styles.stepLabel}>{candidate.label}</span>
          </div>
        )
      })}
    </div>
  )
}
