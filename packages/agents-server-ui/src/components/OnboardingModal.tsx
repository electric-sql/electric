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
  Plug,
  Server,
  Sparkles,
} from 'lucide-react'
import {
  cloudOpenCreateAgentsServer,
  cloudSignIn,
  loadApiKeysStatus,
  loadCloudAuthState,
  loadOnboardingState,
  onCloudAuthStateChanged,
  prepareCloudAgentServerConnection,
  saveApiKeys as persistApiKeys,
  setOnboardingDismissed,
  type ApiKeys,
  type ApiKeysStatus,
  type CloudAuthState,
  type ConnectServerOptions,
} from '../lib/server-connection'
import {
  useAvailableServers,
  type AvailableServer,
} from '../hooks/useAvailableServers'
import { useServerConnection } from '../hooks/useServerConnection'
import { Button, Dialog, Icon, IconButton, Input, Text } from '../ui'
import styles from './OnboardingModal.module.css'

type Step = `cloud` | `keys` | `server`

const STEPS: ReadonlyArray<{ id: Step; label: string }> = [
  { id: `cloud`, label: `Cloud` },
  { id: `keys`, label: `API Keys` },
  { id: `server`, label: `Server` },
]

type ProviderId = keyof ApiKeys

type ProviderKind = `model` | `tool`

const MODEL_PROVIDER_IDS: ReadonlyArray<ProviderId> = [
  `anthropic`,
  `openai`,
  `deepseek`,
]

const PROVIDERS: ReadonlyArray<{
  id: ProviderId
  name: string
  description: string
  placeholder: string
  kind: ProviderKind
}> = [
  {
    id: `anthropic`,
    name: `Anthropic`,
    description: `Claude models — the default for the local runtime.`,
    placeholder: `sk-ant-…`,
    kind: `model`,
  },
  {
    id: `openai`,
    name: `OpenAI`,
    description: `GPT models, including the GPT-5 family.`,
    placeholder: `sk-…`,
    kind: `model`,
  },
  {
    id: `deepseek`,
    name: `DeepSeek`,
    description: `DeepSeek's hosted reasoning models.`,
    placeholder: `sk-…`,
    kind: `model`,
  },
  {
    id: `brave`,
    name: `Brave Search`,
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
  const [bootstrapped, setBootstrapped] = useState(false)

  useEffect(() => {
    if (!isDesktop) return
    let cancelled = false

    void (async () => {
      const [onboarding, cloud, keys] = await Promise.all([
        loadOnboardingState(),
        loadCloudAuthState(),
        loadApiKeysStatus(),
      ])
      if (cancelled) return
      setCloudState(cloud)
      setKeysStatus(keys)
      setBootstrapped(true)

      if (!onboarding || onboarding.dismissed) return
      setStep(
        onboarding.signedIn
          ? onboarding.hasAnyKey
            ? `server`
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
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Content maxWidth={640} className={styles.content}>
        <StepIndicator step={step} />
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
              onContinue={() => setStep(`server`)}
            />
          )}
          {step === `server` && (
            <ServerStep
              cloudState={cloudState}
              onBack={() => setStep(`keys`)}
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
        title="Sign in to Electric Cloud"
        description="Connect this app to your Electric Cloud workspaces to discover hosted agents servers and provision new ones — or skip ahead to use a local or self-hosted server."
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
          <Text size={1} tone="muted">
            Opens dashboard.electric-sql.cloud in a sign-in window. It closes
            automatically once you've authorized.
          </Text>
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
  const hasAnySuggestion = PROVIDERS.some((provider) =>
    Boolean(keysStatus.suggested[provider.id])
  )
  const hasAnyModelKey = MODEL_PROVIDER_IDS.some((id) =>
    Boolean(keysStatus.saved[id])
  )

  const refreshStatus = async () => {
    const next = await loadApiKeysStatus()
    if (next) onKeysStatusChange(next)
  }

  return (
    <>
      <StepHeader
        title="Add provider API keys"
        description="All keys are optional — but to run agents in the bundled local runtime you'll need at least one model provider key (Anthropic, OpenAI, or DeepSeek). Keys are stored on this machine and can be changed anytime in Settings."
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
        {PROVIDERS.map((provider) => (
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

function ProviderItem({
  provider,
  keysStatus,
  onSaved,
}: {
  provider: (typeof PROVIDERS)[number]
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
  onFinish,
}: {
  cloudState: CloudAuthState | null
  onBack: () => void
  onFinish: () => void
}): React.ReactElement {
  const { servers } = useAvailableServers()
  const { addServer, connectServer, setActiveServer } = useServerConnection()
  const [serverError, setServerError] = useState<string | null>(null)
  const [connectingKey, setConnectingKey] = useState<string | null>(null)
  const cloudSignedIn = cloudState?.status === `signed-in`

  const connectAvailableServer = async (item: AvailableServer) => {
    setServerError(null)
    setConnectingKey(item.key)
    const options: ConnectServerOptions = { localRuntimeEnabled: true }
    try {
      if (item.server) {
        setActiveServer(item.server)
        connectServer(item.server.id, options)
        onFinish()
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
        onFinish()
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
        onFinish()
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
            onClick={onFinish}
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

function StepIndicator({ step }: { step: Step }): React.ReactElement {
  const activeIndex = STEPS.findIndex((candidate) => candidate.id === step)

  return (
    <div className={styles.steps} aria-label="Onboarding progress">
      {STEPS.map((candidate, index) => {
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
