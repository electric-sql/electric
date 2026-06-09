import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUp,
  AudioLines,
  Check,
  ChevronDown,
  ChevronRight,
  Cpu,
  Sparkles,
} from 'lucide-react'
import { eq, not, useLiveQuery } from '@tanstack/react-db'
import { COMPOSER_INPUT_MESSAGE_TYPE } from '@electric-ax/agents-runtime/client'
import { nanoid } from 'nanoid'
import { useElectricAgents } from '../../lib/ElectricAgentsProvider'
import { useWorkspace } from '../../hooks/useWorkspace'
import { recentWorkingDirsForRunner } from '../../lib/recentWorkingDirectories'
import {
  isSandboxProfileRemote,
  pickDefaultSandboxProfile,
  useSandboxProfileSelection,
} from '../../lib/sandboxProfiles'
import {
  codexEnableSource,
  loadApiKeysStatus,
  loadDesktopState,
  onDesktopStateChanged,
  restartLocalRuntimes,
  type ApiKeysStatus,
  type CodexAuthSource,
} from '../../lib/server-connection'
import { sendEntityMessage } from '../../lib/sendMessage'
import { Button, Icon, Menu, Select, Stack, Text, Tooltip } from '../../ui'
import { SchemaForm } from '../SchemaForm'
import { WorkingDirectoryPicker } from '../WorkingDirectoryPicker'
import {
  AttachmentActionMenu,
  AttachmentPreviewTray,
  imageAttachmentDraftPolicy,
  useAttachmentDrafts,
} from '../AttachmentDrafts'
import {
  isModelProperty,
  schemaModelSupportsImageInput,
} from '../../lib/modelCapabilities'
import {
  groupModelSettings,
  hasSchemaProperties,
  inlineSchemaProperties,
  modelOptionLabel,
  modelProviderKey,
  MODEL_PROVIDER_LABELS,
} from '../../lib/schemaProperties'
import type {
  InlineSchemaProperty,
  SchemaProperty,
} from '../../lib/schemaProperties'
import { serializeComposerInput } from '@electric-ax/agents-runtime/client'
import { ComposerEditor } from '../ComposerEditor'
import { ComposerShell } from '../ComposerShell'
import styles from '../NewSessionPage.module.css'
import type {
  ElectricEntityType,
  ElectricRunner,
  ElectricSandboxProfile,
} from '../../lib/ElectricAgentsProvider'
import type {
  ComposerInputPayload,
  SlashCommandRow,
} from '@electric-ax/agents-runtime/client'
import type { StandaloneViewProps } from '../../lib/workspace/viewRegistry'
import type { TileViewParams } from '../../lib/workspace/types'

/**
 * The "default agent" — when an entity type with this name is registered
 * we surface a chat-input quick-start at the top of the new-session view
 * so the most common flow is one keystroke away.
 */
const DEFAULT_AGENT_NAME = `horton`
const REALTIME_AUTOSTART_VIEW_PARAMS: TileViewParams = { realtime: `start` }

const HERO_TITLES = [
  `Let’s ship`,
  `Let’s create`,
  `Let’s build`,
  `Let’s explore`,
  `Let’s debug`,
  `Let’s design`,
  `Let’s hack`,
  `Let’s improve`,
] as const

const LAST_PICKED_MODEL_STORAGE_KEY = `electric-agents-ui.new-session.last-picked-model`

function readLastPickedModel(options: Array<string>): string | null {
  if (typeof window === `undefined`) return null
  try {
    const value = window.localStorage.getItem(LAST_PICKED_MODEL_STORAGE_KEY)
    return value && options.includes(value) ? value : null
  } catch {
    return null
  }
}

function persistLastPickedModel(value: string): void {
  if (typeof window === `undefined`) return
  try {
    window.localStorage.setItem(LAST_PICKED_MODEL_STORAGE_KEY, value)
  } catch {
    // Quota / private mode — silent. This is only a picker convenience.
  }
}

// Per-source dismissal of the local-Codex-detected prompt. Stored as a
// flat array of source identifiers in localStorage so the prompt
// doesn't reappear on every reload after the user explicitly waved it
// off, but is still re-shown if a different login source becomes
// available later.
const CODEX_PROMPT_DISMISSED_KEY = `electric-agents-ui.codex-prompt.dismissed-sources`

function readCodexPromptDismissed(): Array<CodexAuthSource> {
  if (typeof window === `undefined`) return []
  try {
    const raw = window.localStorage.getItem(CODEX_PROMPT_DISMISSED_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Array<CodexAuthSource>) : []
  } catch {
    return []
  }
}

function persistCodexPromptDismissed(value: Array<CodexAuthSource>): void {
  if (typeof window === `undefined`) return
  try {
    window.localStorage.setItem(
      CODEX_PROMPT_DISMISSED_KEY,
      JSON.stringify(value)
    )
  } catch {
    // Quota / private mode — silent.
  }
}

/**
 * Standalone view: the new-session picker.
 *
 * Rendered inside a `<TileContainer>` like any other view, so it can
 * be split / dragged / replaced through the same workspace machinery.
 *
 * When the user spawns a session, the workspace helper replaces *this
 * tile* with the new entity (rather than navigating off the page) so
 * other tiles in adjacent splits stay intact. The address bar still
 * reflects the active tile via the URL ↔ workspace sync in
 * `<Workspace />`.
 */
export function NewSessionView({
  baseUrl,
  tileId,
  setToolbarTitle,
}: StandaloneViewProps): React.ReactElement {
  const {
    entitiesCollection,
    entityTypesCollection,
    runnersCollection,
    spawnEntity,
  } = useElectricAgents()
  const { helpers } = useWorkspace()
  const [selected, setSelected] = useState<ElectricEntityType | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [workingDirectory, setWorkingDirectory] = useState<string | null>(null)

  const { data: entityTypes = [], isLoading: entityTypesLoading } =
    useLiveQuery(
      (query) => {
        if (!entityTypesCollection) return undefined
        return query
          .from({ t: entityTypesCollection })
          .where(({ t }) => not(eq(t.name, `worker`)))
          .where(({ t }) => not(eq(t.name, `principal`)))
          .orderBy(({ t }) => t.name, `asc`)
      },
      [entityTypesCollection]
    )

  const { data: enabledRunners = [], isLoading: runnersLoading } = useLiveQuery(
    (query) => {
      if (!runnersCollection) return undefined
      return query
        .from({ r: runnersCollection })
        .where(({ r }) => eq(r.admin_status, `enabled`))
        .orderBy(({ r }) => r.updated_at, `desc`)
        .orderBy(({ r }) => r.label, `asc`)
    },
    [runnersCollection]
  )

  // The Electron shell registers its own pull-wake runner. When that
  // runner is one of the available choices we prefer it as the default
  // selection (preserves the old desktop behaviour of routing wakes to
  // the bundled local runtime). `null` outside Electron / before the
  // first state fetch.
  const isDesktop = typeof window !== `undefined` && Boolean(window.electronAPI)
  const [desktopRunnerId, setDesktopRunnerId] = useState<string | null>(null)
  const [desktopRunnerLoaded, setDesktopRunnerLoaded] = useState(!isDesktop)
  useEffect(() => {
    let cancelled = false
    void loadDesktopState().then((s) => {
      if (cancelled) return
      setDesktopRunnerId(s?.pullWakeRunnerId?.trim() || null)
      setDesktopRunnerLoaded(true)
    })
    const off = onDesktopStateChanged((s) => {
      setDesktopRunnerId(s?.pullWakeRunnerId?.trim() || null)
      setDesktopRunnerLoaded(true)
    })
    return () => {
      cancelled = true
      off?.()
    }
  }, [])

  const [selectedRunnerId, setSelectedRunnerId] = useState<string | null>(null)
  const userSelectedRunnerRef = useRef(false)
  const handleChangeSelectedRunner = useCallback((id: string | null) => {
    userSelectedRunnerRef.current = true
    setSelectedRunnerId(id)
  }, [])
  const selectedRunnerStillExists =
    selectedRunnerId !== null &&
    enabledRunners.some((r) => r.id === selectedRunnerId)
  const desktopRunnerStillExists =
    desktopRunnerId !== null &&
    enabledRunners.some((r) => r.id === desktopRunnerId)
  const effectiveRunnerId =
    !userSelectedRunnerRef.current && desktopRunnerStillExists
      ? desktopRunnerId
      : selectedRunnerStillExists
        ? selectedRunnerId
        : (enabledRunners[0]?.id ?? null)

  // Re-evaluate the default whenever the list of runners or the desktop's
  // runner id changes. An explicit user choice (tracked via
  // `userSelectedRunnerRef`) wins while it still exists; otherwise prefer the
  // desktop's own runner if enabled, else fall back to the first runner.
  useEffect(() => {
    if (enabledRunners.length === 0) {
      if (selectedRunnerId !== null) setSelectedRunnerId(null)
      userSelectedRunnerRef.current = false
      return
    }

    if (!selectedRunnerStillExists) {
      userSelectedRunnerRef.current = false
    }

    const preferredRunnerId =
      !userSelectedRunnerRef.current && desktopRunnerStillExists
        ? desktopRunnerId
        : selectedRunnerStillExists
          ? selectedRunnerId
          : enabledRunners[0]!.id

    if (selectedRunnerId !== preferredRunnerId) {
      setSelectedRunnerId(preferredRunnerId)
    }
  }, [
    desktopRunnerId,
    desktopRunnerStillExists,
    enabledRunners,
    selectedRunnerId,
    selectedRunnerStillExists,
  ])

  // Recent working directories are derived from the synced sessions
  // dispatched to the selected runner (`spawn_args.workingDirectory`), so
  // the same per-runner list appears on every device — no local storage.
  const { data: allEntities = [] } = useLiveQuery(
    (query) => {
      if (!entitiesCollection) return undefined
      return query.from({ e: entitiesCollection })
    },
    [entitiesCollection]
  )
  const recentDirs = useMemo(
    () =>
      selectedRunnerId
        ? recentWorkingDirsForRunner(allEntities, selectedRunnerId)
        : [],
    [allEntities, selectedRunnerId]
  )

  // Default to the selected runner's most-recently-used directory so a user
  // who keeps opening sessions against the same project root doesn't have to
  // re-select it each time. An explicit pick wins until the runner changes —
  // paths from one machine may not exist on another, so switching runner
  // re-derives the default.
  const userPickedDirRef = useRef(false)
  const handleChangeWorkingDirectory = useCallback((path: string | null) => {
    userPickedDirRef.current = true
    setWorkingDirectory(path)
  }, [])
  useEffect(() => {
    userPickedDirRef.current = false
  }, [selectedRunnerId])
  useEffect(() => {
    if (userPickedDirRef.current) return
    setWorkingDirectory(recentDirs[0] ?? null)
  }, [recentDirs])

  // Sandbox profiles ride alongside the runner row. Read the advertised
  // list off whichever runner the spawn will dispatch to, preserving the
  // runtime's advertised order (default profile first).
  const allSandboxProfiles = useMemo<Array<ElectricSandboxProfile>>(() => {
    if (!effectiveRunnerId) return []
    const runner = enabledRunners.find((r) => r.id === effectiveRunnerId)
    if (!runner) return []
    // A runner row may sync before its sandbox_profiles are populated (or
    // predate the column), so guard against a missing/non-array value.
    //
    // Preserve the runtime's advertised order — do NOT sort. The runtime
    // advertises its default profile first (e.g. `local` before `docker`),
    // and `pickDefaultSandboxProfile` selects `profiles[0]`. Sorting (e.g. by
    // label) would silently make a different profile the default — sorting by
    // label put "Docker" ahead of "Local", defaulting new sessions to Docker
    // wherever the daemon is reachable.
    return [...(runner.sandbox_profiles ?? [])]
  }, [effectiveRunnerId, enabledRunners])

  const defaultAgent = useMemo(
    () => entityTypes.find((t) => t.name === DEFAULT_AGENT_NAME) ?? null,
    [entityTypes]
  )
  const otherAgents = useMemo(
    () => entityTypes.filter((t) => t.name !== DEFAULT_AGENT_NAME),
    [entityTypes]
  )

  /**
   * Spawn an entity and let the server enqueue any initial user message.
   * The server links dispatch before writing that message, avoiding a
   * client-side stream preload on the critical path to the first wake.
   */
  const doSpawn = useCallback(
    async (
      typeName: string,
      args?: Record<string, unknown>,
      initialMessage?: unknown,
      initialMessageType?: string,
      initialAttachments?: Array<File>,
      sandboxProfile?: string | null,
      viewParams?: TileViewParams
    ): Promise<boolean> => {
      if (!spawnEntity) return false
      setError(null)
      const name = nanoid(10)
      const hasInitialAttachments =
        initialAttachments !== undefined && initialAttachments.length > 0
      const initialText =
        typeof initialMessage === `string`
          ? initialMessage.trim()
          : initialMessage &&
              typeof initialMessage === `object` &&
              typeof (initialMessage as { source?: unknown }).source ===
                `string`
            ? (initialMessage as { source: string }).source.trim()
            : ``
      const tx = spawnEntity({
        type: typeName,
        name,
        args,
        ...(effectiveRunnerId
          ? {
              dispatch_policy: {
                targets: [
                  { type: `runner` as const, runnerId: effectiveRunnerId },
                ],
              },
            }
          : {}),
        // Key by the session URL for a persistent, shared workspace: files
        // survive across wakes and spawned subagents share the container.
        ...(sandboxProfile
          ? {
              sandbox: {
                profile: sandboxProfile,
                key: `/${typeName}/${name}`,
              },
            }
          : {}),
        ...(initialMessage !== undefined && !hasInitialAttachments
          ? { initialMessage }
          : {}),
        ...(initialMessageType ? { initialMessageType } : {}),
      })
      const entityUrl = `/${typeName}/${name}`
      try {
        await tx.isPersisted.promise
        if (hasInitialAttachments) {
          await sendEntityMessage({
            baseUrl,
            entityUrl,
            text: initialText,
            mode: `immediate`,
            attachments: initialAttachments,
          })
        }
        helpers.openEntity(entityUrl, {
          target: { tileId, position: `replace` },
          ...(viewParams ? { viewParams } : {}),
        })
        return true
      } catch (err) {
        setError(
          `Could not start session: ${err instanceof Error ? err.message : String(err)}.`
        )
        return false
      }
    },
    [baseUrl, effectiveRunnerId, helpers, spawnEntity, tileId]
  )

  const handleSelectType = useCallback(
    (entityType: ElectricEntityType) => {
      if (hasSchemaProperties(entityType.creation_schema)) {
        setSelected(entityType)
        return
      }
      void doSpawn(entityType.name)
    },
    [doSpawn]
  )

  const handleCancelSelected = useCallback(() => {
    setSelected(null)
  }, [])

  useEffect(() => {
    if (!setToolbarTitle) return

    if (!selected) {
      setToolbarTitle(null)
      return
    }

    setToolbarTitle(
      <button
        type="button"
        className={styles.toolbarBackLink}
        onClick={handleCancelSelected}
      >
        ← Back to agents
      </button>
    )

    return () => setToolbarTitle(null)
  }, [handleCancelSelected, selected, setToolbarTitle])

  const prepareDefaultAgentArgs = useCallback(
    (
      args: Record<string, unknown>,
      sandboxProfile: string | null
    ): Record<string, unknown> => {
      // Inject the picker's choice into the spawn args for the default-agent
      // composer only — non-default agents have their own schemas and may not
      // understand `workingDirectory`. Remote sandboxes run in provider VMs, so
      // host paths are meaningless there.
      const profileIsRemote = isSandboxProfileRemote(
        allSandboxProfiles,
        sandboxProfile
      )
      // A working directory only takes effect through a sandbox-profile
      // factory — require a (non-remote) profile or the arg is a no-op.
      const includeWorkingDir =
        workingDirectory !== null && sandboxProfile !== null && !profileIsRemote
      return includeWorkingDir ? { ...args, workingDirectory } : args
    },
    [allSandboxProfiles, workingDirectory]
  )

  const handleStartDefault = useCallback(
    async (
      input: string | ComposerInputPayload,
      args: Record<string, unknown>,
      attachments: Array<File>,
      sandboxProfile: string | null
    ): Promise<boolean> => {
      if (!defaultAgent) return false
      const augmented = prepareDefaultAgentArgs(args, sandboxProfile)
      const hasAttachments = attachments.length > 0
      const initialMessage =
        typeof input === `string`
          ? input
          : hasAttachments
            ? input.source
            : input
      const initialMessageType =
        typeof input === `string` || hasAttachments
          ? undefined
          : COMPOSER_INPUT_MESSAGE_TYPE
      return await doSpawn(
        defaultAgent.name,
        augmented,
        initialMessage,
        initialMessageType,
        attachments,
        sandboxProfile
      )
    },
    [defaultAgent, doSpawn, prepareDefaultAgentArgs]
  )

  const handleStartDefaultRealtime = useCallback(
    async (
      args: Record<string, unknown>,
      sandboxProfile: string | null
    ): Promise<boolean> => {
      if (!defaultAgent) return false
      const augmented = prepareDefaultAgentArgs(args, sandboxProfile)
      return await doSpawn(
        defaultAgent.name,
        augmented,
        undefined,
        undefined,
        undefined,
        sandboxProfile,
        REALTIME_AUTOSTART_VIEW_PARAMS
      )
    },
    [defaultAgent, doSpawn, prepareDefaultAgentArgs]
  )

  const defaultComposerReady =
    Boolean(spawnEntity) &&
    !entityTypesLoading &&
    !runnersLoading &&
    desktopRunnerLoaded &&
    (!isDesktop || desktopRunnerId === null || desktopRunnerStillExists) &&
    effectiveRunnerId !== null

  return (
    <div className={styles.body}>
      <div className={styles.container}>
        {selected ? (
          <SelectedAgentForm
            entityType={selected}
            sandboxProfiles={allSandboxProfiles}
            onCancel={handleCancelSelected}
            onSubmit={(args, sandboxProfile) =>
              void doSpawn(
                selected.name,
                args,
                undefined,
                undefined,
                undefined,
                sandboxProfile
              )
            }
            error={error}
          />
        ) : (
          <Picker
            defaultAgent={defaultAgent}
            otherAgents={otherAgents}
            defaultAgentSandboxProfiles={defaultAgent ? allSandboxProfiles : []}
            onSelectType={handleSelectType}
            onStartDefault={handleStartDefault}
            onStartDefaultRealtime={handleStartDefaultRealtime}
            spawnReady={Boolean(spawnEntity)}
            defaultComposerReady={defaultComposerReady}
            error={error}
            workingDirectory={workingDirectory}
            onChangeWorkingDirectory={handleChangeWorkingDirectory}
            recentWorkingDirs={recentDirs}
            runners={enabledRunners}
            selectedRunnerId={effectiveRunnerId}
            onChangeSelectedRunner={handleChangeSelectedRunner}
          />
        )}
      </div>
    </div>
  )
}

function Picker({
  defaultAgent,
  otherAgents,
  defaultAgentSandboxProfiles,
  onSelectType,
  onStartDefault,
  onStartDefaultRealtime,
  spawnReady,
  defaultComposerReady,
  error,
  workingDirectory,
  onChangeWorkingDirectory,
  recentWorkingDirs,
  runners,
  selectedRunnerId,
  onChangeSelectedRunner,
}: {
  defaultAgent: ElectricEntityType | null
  otherAgents: Array<ElectricEntityType>
  defaultAgentSandboxProfiles: Array<ElectricSandboxProfile>
  onSelectType: (t: ElectricEntityType) => void
  onStartDefault: (
    input: string | ComposerInputPayload,
    args: Record<string, unknown>,
    attachments: Array<File>,
    sandboxProfile: string | null
  ) => Promise<boolean>
  onStartDefaultRealtime: (
    args: Record<string, unknown>,
    sandboxProfile: string | null
  ) => Promise<boolean>
  spawnReady: boolean
  defaultComposerReady: boolean
  error: string | null
  workingDirectory: string | null
  onChangeWorkingDirectory: (path: string | null) => void
  recentWorkingDirs: ReadonlyArray<string>
  runners: Array<ElectricRunner>
  selectedRunnerId: string | null
  onChangeSelectedRunner: (id: string | null) => void
}): React.ReactElement {
  const hasAnyAgent = defaultAgent !== null || otherAgents.length > 0
  const [heroTitle] = useState(
    () => HERO_TITLES[Math.floor(Math.random() * HERO_TITLES.length)]
  )

  return (
    <Stack direction="column" gap={5} className={styles.pickerFlow}>
      <div className={styles.heading}>
        <Text size={7} as="h1" className={styles.headingTitle}>
          {heroTitle}
        </Text>
        {!defaultAgent && (
          <span className={styles.headingSubtitle}>
            Pick the kind of agent you want to spawn.
          </span>
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {defaultAgent && (
        <DefaultAgentComposer
          agent={defaultAgent}
          sandboxProfiles={defaultAgentSandboxProfiles}
          onSubmit={onStartDefault}
          onStartRealtime={onStartDefaultRealtime}
          disabled={!defaultComposerReady}
          workingDirectory={workingDirectory}
          onChangeWorkingDirectory={onChangeWorkingDirectory}
          recentWorkingDirs={recentWorkingDirs}
          runners={runners}
          selectedRunnerId={selectedRunnerId}
          onChangeSelectedRunner={onChangeSelectedRunner}
        />
      )}

      <CodexDetectedPrompt />

      {otherAgents.length > 0 && (
        <div className={styles.otherAgents}>
          {defaultAgent && (
            <Text size={1} tone="muted" className={styles.otherAgentsLabel}>
              Other agents
            </Text>
          )}
          <div className={styles.typeGrid}>
            {otherAgents.map((t) => (
              <button
                key={t.name}
                type="button"
                className={styles.typeCard}
                onClick={() => onSelectType(t)}
                disabled={!spawnReady}
              >
                <span className={styles.typeCardName}>{t.name}</span>
                {t.description && (
                  <span className={styles.typeCardDescription}>
                    {t.description}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {!hasAnyAgent && (
        <div className={styles.empty}>
          No entity types registered. Make sure your agents server is running
          and reachable.
        </div>
      )}
    </Stack>
  )
}

/**
 * Inline opt-in prompt rendered under the default-agent composer. When
 * the desktop main process detects an existing local Codex login (Codex
 * CLI or OpenCode) but the user hasn't approved it yet, surface a small
 * "Use this login?" banner here so the user can opt in without leaving
 * the new-session flow. Each source can be dismissed independently —
 * that decision is persisted in localStorage so the prompt doesn't
 * keep reappearing after an explicit wave-off, but does come back if a
 * different source is added later.
 *
 * Hidden in the web build (no `window.electronAPI`) and once the user
 * has any Codex source enabled (the Credentials settings screen takes
 * over from there).
 */
function CodexDetectedPrompt(): React.ReactElement | null {
  const isDesktop = typeof window !== `undefined` && Boolean(window.electronAPI)
  const [status, setStatus] = useState<ApiKeysStatus | null>(null)
  const [dismissed, setDismissed] = useState<Array<CodexAuthSource>>(() =>
    readCodexPromptDismissed()
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isDesktop) return
    let cancelled = false
    void loadApiKeysStatus().then((next) => {
      if (cancelled) return
      setStatus(next)
    })
    // Refresh codex status when the desktop state changes — covers
    // the case where the user enables/disables Codex elsewhere (e.g.
    // the Credentials settings page) while the new-session view is
    // still mounted, so the prompt stays in sync.
    const off = onDesktopStateChanged(() => {
      void loadApiKeysStatus().then((next) => {
        if (cancelled) return
        setStatus(next)
      })
    })
    return () => {
      cancelled = true
      off?.()
    }
  }, [isDesktop])

  if (!isDesktop || !status) return null
  if (status.codex.enabled) return null

  const candidates = status.codex.availableSources.filter(
    (source) =>
      source.source !== `desktop-oauth` && !dismissed.includes(source.source)
  )
  if (candidates.length === 0) return null

  const primary = candidates[0]!
  const shortName =
    primary.source === `codex-cli`
      ? `Codex CLI`
      : primary.source === `opencode`
        ? `OpenCode`
        : `Codex`

  const handleApprove = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await codexEnableSource(primary.source)
      // Approving from here is a "yes, use this now" gesture — bounce
      // any connected local runtime so the new credential takes effect
      // immediately for the session the user is about to spawn,
      // instead of leaving a "Restart local runtime" banner sitting in
      // the Credentials settings page that the user would have to find
      // and click. No-op when no local runtime is connected.
      await restartLocalRuntimes()
      const next = await loadApiKeysStatus()
      if (next) setStatus(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleDismiss = (): void => {
    const next = [...dismissed, primary.source]
    setDismissed(next)
    persistCodexPromptDismissed(next)
  }

  return (
    <div className={styles.codexPrompt}>
      <Icon icon={Sparkles} size={2} />
      <span className={styles.codexPromptText}>
        Found a local {shortName} sign-in. Use it for ChatGPT / Codex models?
      </span>
      <span className={styles.codexPromptActions}>
        <Button
          type="button"
          size={1}
          variant="ghost"
          tone="neutral"
          onClick={handleDismiss}
          disabled={busy}
        >
          Dismiss
        </Button>
        <Button
          type="button"
          size={1}
          variant="soft"
          tone="neutral"
          onClick={() => {
            void handleApprove()
          }}
          disabled={busy}
        >
          {busy ? `Connecting…` : `Use this login`}
        </Button>
      </span>
      {error && (
        <span className={styles.codexPromptError} role="alert">
          {error}
        </span>
      )}
    </div>
  )
}

function SelectedAgentForm({
  entityType,
  sandboxProfiles,
  onCancel,
  onSubmit,
  error,
}: {
  entityType: ElectricEntityType
  sandboxProfiles: Array<ElectricSandboxProfile>
  onCancel: () => void
  onSubmit: (
    args: Record<string, unknown>,
    sandboxProfile: string | null
  ) => void
  error: string | null
}): React.ReactElement {
  const [sandboxProfile, setSandboxProfile] =
    useSandboxProfileSelection(sandboxProfiles)
  return (
    <Stack direction="column" gap={4} className={styles.selectedFlow}>
      <div className={styles.heading}>
        <Text size={5} as="h1" className={styles.headingTitle}>
          Start a new {entityType.name} session
        </Text>
        {entityType.description && (
          <span className={styles.headingSubtitle}>
            {entityType.description}
          </span>
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.formCard}>
        <div className={styles.formHeader}>
          <div className={styles.formHeaderText}>
            <Text size={3}>{entityType.name}</Text>
          </div>
        </div>
        <SchemaForm
          schema={entityType.creation_schema}
          submitLabel="Create"
          onSubmit={(args) => onSubmit(args, sandboxProfile)}
          onCancel={onCancel}
          extraRows={
            sandboxProfiles.length > 0 ? (
              <SandboxProfileRow
                profiles={sandboxProfiles}
                value={sandboxProfile}
                onChange={setSandboxProfile}
              />
            ) : null
          }
        />
      </div>
    </Stack>
  )
}

function sandboxProfileLabel(profile: ElectricSandboxProfile): string {
  return profile.name === `local` ? `No sandbox` : profile.label
}

function SandboxProfileRow({
  profiles,
  value,
  onChange,
}: {
  profiles: ReadonlyArray<ElectricSandboxProfile>
  value: string | null
  onChange: (next: string) => void
}): React.ReactElement {
  const selectedValue = value ?? pickDefaultSandboxProfile(profiles)
  return (
    <Stack direction="column" gap={1}>
      <Text size={1} tone="muted">
        Sandbox
      </Text>
      <Select.Root<string>
        value={selectedValue}
        onValueChange={(v) => {
          if (v) onChange(v)
        }}
      >
        <Select.Trigger />
        <Select.Content>
          {profiles.map((p) => (
            <Select.Item key={p.name} value={p.name}>
              {sandboxProfileLabel(p)}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </Stack>
  )
}

function DefaultAgentComposer({
  agent,
  sandboxProfiles,
  onSubmit,
  onStartRealtime,
  disabled,
  workingDirectory,
  onChangeWorkingDirectory,
  recentWorkingDirs,
  runners,
  selectedRunnerId,
  onChangeSelectedRunner,
}: {
  agent: ElectricEntityType
  sandboxProfiles: ReadonlyArray<ElectricSandboxProfile>
  onSubmit: (
    input: string | ComposerInputPayload,
    args: Record<string, unknown>,
    attachments: Array<File>,
    sandboxProfile: string | null
  ) => Promise<boolean>
  onStartRealtime: (
    args: Record<string, unknown>,
    sandboxProfile: string | null
  ) => Promise<boolean>
  disabled?: boolean
  workingDirectory: string | null
  onChangeWorkingDirectory: (path: string | null) => void
  recentWorkingDirs: ReadonlyArray<string>
  runners: Array<ElectricRunner>
  selectedRunnerId: string | null
  onChangeSelectedRunner: (id: string | null) => void
}): React.ReactElement {
  const [sandboxProfile, setSandboxProfile] =
    useSandboxProfileSelection(sandboxProfiles)
  const selectedSandboxProfile =
    sandboxProfile ?? pickDefaultSandboxProfile(sandboxProfiles)
  // A remote sandbox lives in the provider VM, so a host working directory
  // doesn't apply — hide the picker for those profiles.
  const selectedProfileIsRemote = useMemo(
    () => isSandboxProfileRemote(sandboxProfiles, selectedSandboxProfile),
    [sandboxProfiles, selectedSandboxProfile]
  )
  const [value, setValue] = useState(``)
  const [submittingMode, setSubmittingMode] = useState<
    `message` | `realtime` | null
  >(null)
  const submitting = submittingMode !== null
  const realtimeSubmitting = submittingMode === `realtime`
  const composerFocusRef = useRef<{ focus: () => void } | null>(null)
  const inlineProps = useMemo(
    () => inlineSchemaProperties(agent.creation_schema),
    [agent.creation_schema]
  )
  const {
    modelSettings: modelSettingsProps,
    standalone: standaloneInlineProps,
  } = useMemo(() => groupModelSettings(inlineProps), [inlineProps])
  const slashCommands = useMemo<Array<SlashCommandRow>>(
    () =>
      (agent.slash_commands ?? []).map((command) => ({
        ...command,
        key: `static:${command.name}`,
        source: `static`,
        updated_at: agent.updated_at,
      })),
    [agent.slash_commands, agent.updated_at]
  )
  const [args, setArgs] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {}
    for (const { key, prop } of inlineProps) {
      if (prop.enum && prop.enum.length > 0 && isModelProperty(key)) {
        const options = prop.enum.map((v) => String(v))
        const lastPicked = readLastPickedModel(options)
        if (lastPicked !== null) {
          init[key] =
            prop.enum.find((v) => String(v) === lastPicked) ?? lastPicked
          continue
        }
      }
      if (prop.default !== undefined) {
        init[key] = prop.default
      } else if (prop.enum && prop.enum.length > 0) {
        init[key] = prop.enum[0]
      } else if (prop.type === `boolean`) {
        init[key] = false
      }
    }
    return init
  })
  const setEnumArg = useCallback(
    (key: string, prop: SchemaProperty, next: string) => {
      const original = prop.enum?.find((v) => String(v) === next)
      if (isModelProperty(key)) persistLastPickedModel(next)
      setArgs((prev) => ({ ...prev, [key]: original ?? next }))
    },
    []
  )
  const imageAttachmentsEnabled = schemaModelSupportsImageInput(
    agent.creation_schema,
    args
  )
  const {
    attachments,
    clearAttachments,
    dropActive,
    dropZoneProps,
    fileInputRef,
    addAttachments,
    openAttachmentPicker,
    handlePaste,
    removeAttachment,
  } = useAttachmentDrafts({
    policy: imageAttachmentDraftPolicy,
    disabled: disabled || submitting || !imageAttachmentsEnabled,
    focusRef: composerFocusRef,
  })

  useEffect(() => {
    if (!imageAttachmentsEnabled) clearAttachments()
  }, [imageAttachmentsEnabled, clearAttachments])

  const submit = useCallback(
    (payload?: ComposerInputPayload) => {
      const files = imageAttachmentsEnabled ? attachments : []
      const nextPayload =
        payload ?? serializeComposerInput(value, slashCommands)
      const trimmed = nextPayload.source.trim()
      if ((!trimmed && files.length === 0) || disabled || submitting) return
      setSubmittingMode(`message`)
      const cleaned: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(args)) {
        if (v !== undefined && v !== ``) cleaned[k] = v
      }
      void onSubmit(
        files.length > 0 ? trimmed : nextPayload,
        cleaned,
        files,
        selectedSandboxProfile
      )
        .then((ok) => {
          if (ok) {
            clearAttachments()
            setValue(``)
          }
        })
        .catch(() => undefined)
        .finally(() => {
          setSubmittingMode(null)
        })
    },
    [
      args,
      attachments,
      imageAttachmentsEnabled,
      clearAttachments,
      disabled,
      onSubmit,
      selectedSandboxProfile,
      slashCommands,
      submitting,
      value,
    ]
  )

  const startRealtime = useCallback(() => {
    const files = imageAttachmentsEnabled ? attachments : []
    if (disabled || submitting || files.length > 0) return
    setSubmittingMode(`realtime`)
    const cleaned: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(args)) {
      if (v !== undefined && v !== ``) cleaned[k] = v
    }
    void onStartRealtime(cleaned, selectedSandboxProfile)
      .catch(() => undefined)
      .finally(() => {
        setSubmittingMode(null)
      })
  }, [
    args,
    attachments,
    disabled,
    imageAttachmentsEnabled,
    onStartRealtime,
    selectedSandboxProfile,
    submitting,
  ])

  const attachmentCount = imageAttachmentsEnabled ? attachments.length : 0
  const isActive = Boolean(
    (value.trim() || attachmentCount > 0) && !disabled && !submitting
  )
  const placeholder = disabled ? `Connecting…` : `Ask ${agent.name} anything…`
  const sendTooltip = submitting
    ? `Starting ${agent.name} session`
    : `Start ${agent.name} session`
  const realtimeTooltip =
    attachmentCount > 0
      ? `Remove attachments to start voice mode`
      : realtimeSubmitting
        ? `Starting voice session`
        : `Start voice session`

  return (
    <div
      className={[
        styles.composerWrap,
        disabled ? styles.composerDisabled : null,
      ]
        .filter(Boolean)
        .join(` `)}
    >
      <ComposerShell
        className={styles.spawnComposerShell}
        disabled={disabled}
        dropActive={dropActive}
        onPaste={handlePaste}
        dropZoneProps={dropZoneProps}
        attachments={
          imageAttachmentsEnabled ? (
            <AttachmentPreviewTray
              attachments={attachments}
              onRemove={removeAttachment}
            />
          ) : null
        }
        controls={
          <>
            {imageAttachmentsEnabled && (
              <AttachmentActionMenu
                disabled={disabled || submitting}
                accept={imageAttachmentDraftPolicy.accept}
                fileInputRef={fileInputRef}
                onFilesSelected={addAttachments}
                onAttach={openAttachmentPicker}
              />
            )}
            {modelSettingsProps && (
              <ModelSettingsMenu
                model={modelSettingsProps.model}
                reasoning={modelSettingsProps.reasoning}
                speed={modelSettingsProps.speed}
                args={args}
                onChange={setEnumArg}
                disabled={submitting || disabled}
              />
            )}
            {standaloneInlineProps.map(({ key, prop }) =>
              prop.enum ? (
                <PillSelect
                  key={key}
                  label={prop.title ?? key}
                  value={String(args[key] ?? ``)}
                  options={prop.enum.map((v) => String(v))}
                  groupByProvider={isModelProperty(key)}
                  onChange={(next) => setEnumArg(key, prop, next)}
                  disabled={submitting || disabled}
                />
              ) : prop.type === `boolean` ? (
                <PillToggle
                  key={key}
                  label={prop.title ?? key}
                  checked={Boolean(args[key])}
                  onChange={(checked) =>
                    setArgs((prev) => ({ ...prev, [key]: checked }))
                  }
                  disabled={submitting || disabled}
                />
              ) : null
            )}
          </>
        }
        send={
          <>
            {submitting && (
              <span className={styles.composerHint}>
                {realtimeSubmitting ? `Starting voice…` : `Starting…`}
              </span>
            )}
            <Tooltip content={realtimeTooltip} side="top">
              <span className={styles.tooltipTrigger}>
                <button
                  type="button"
                  aria-label="Start voice session"
                  onClick={startRealtime}
                  disabled={disabled || submitting || attachmentCount > 0}
                  className={[
                    styles.composerVoice,
                    realtimeSubmitting ? styles.composerVoicePending : null,
                  ]
                    .filter(Boolean)
                    .join(` `)}
                >
                  <Icon icon={AudioLines} size={2} />
                </button>
              </span>
            </Tooltip>
            <Tooltip content={sendTooltip} side="top">
              <span className={styles.tooltipTrigger}>
                <button
                  type="button"
                  aria-label={`Start ${agent.name} session`}
                  onClick={() => submit()}
                  disabled={!isActive}
                  className={[
                    styles.composerSend,
                    isActive ? styles.composerSendActive : null,
                  ]
                    .filter(Boolean)
                    .join(` `)}
                >
                  <Icon icon={ArrowUp} size={3} />
                </button>
              </span>
            </Tooltip>
          </>
        }
      >
        <ComposerEditor
          value={value}
          onChange={setValue}
          onSubmit={submit}
          slashCommands={slashCommands}
          placeholder={placeholder}
          disabled={disabled || submitting}
        />
      </ComposerShell>
      <div className={styles.composerMeta}>
        {runners.length > 0 && (
          <RunnerPickerPill
            runners={runners}
            value={selectedRunnerId}
            onChange={onChangeSelectedRunner}
            disabled={submitting || disabled}
          />
        )}
        {sandboxProfiles.length > 0 ? (
          <PillSelect
            label="Sandbox"
            value={selectedSandboxProfile ?? ``}
            options={sandboxProfiles.map((p) => p.name)}
            optionLabels={Object.fromEntries(
              sandboxProfiles.map((p) => [p.name, sandboxProfileLabel(p)])
            )}
            onChange={(next) => setSandboxProfile(next)}
            disabled={submitting || disabled}
          />
        ) : null}
        {/* Working directory comes last: the chosen sandbox decides whether a
            host directory is even relevant. It only takes effect through a
            sandbox-profile factory, so the picker is hidden when the runner
            advertises no profiles — and for remote profiles, where the
            workspace lives in the provider VM. */}
        {selectedSandboxProfile !== null && !selectedProfileIsRemote && (
          <WorkingDirectoryPicker
            value={workingDirectory}
            onChange={onChangeWorkingDirectory}
            recents={recentWorkingDirs}
            disabled={submitting || disabled}
          />
        )}
      </div>
    </div>
  )
}

function RunnerPickerPill({
  runners,
  value,
  onChange,
  disabled,
}: {
  runners: Array<ElectricRunner>
  value: string | null
  onChange: (id: string | null) => void
  disabled?: boolean
}): React.ReactElement | null {
  if (runners.length === 0) return null
  // The trigger needs to display the runner's *label*, not its id.
  // base-ui's `Select.Value` falls back to rendering the raw value
  // string when its `children` render function is omitted — which
  // would show the runner UUID. Use `renderValue` to look the label
  // up out of the current `runners` list instead.
  const renderValue = (id: string | null): React.ReactNode => {
    if (!id) return `Pick runner`
    const runner = runners.find((r) => r.id === id)
    return runner ? runner.label || runner.id : id
  }
  return (
    <Select.Root<string>
      value={value}
      onValueChange={(next) => onChange(next)}
      disabled={disabled}
    >
      <Select.Trigger
        size="pill"
        aria-label="Runner"
        tooltip="Runner that will handle this session"
        placeholder="Pick runner"
        icon={Cpu}
        renderValue={renderValue}
      />
      <Select.Content>
        {runners.map((runner) => (
          <Select.Item key={runner.id} value={runner.id}>
            {runner.label || runner.id}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  )
}

function modelProviderLabel(provider: string): string {
  return MODEL_PROVIDER_LABELS[provider] ?? provider
}

function groupedModelOptions(
  options: Array<string>
): Array<{ provider: string; label: string; options: Array<string> }> {
  const groups: Array<{
    provider: string
    label: string
    options: Array<string>
  }> = []
  const byProvider = new Map<string, (typeof groups)[number]>()
  for (const option of options) {
    const provider = modelProviderKey(option)
    let group = byProvider.get(provider)
    if (!group) {
      group = {
        provider,
        label: modelProviderLabel(provider),
        options: [],
      }
      byProvider.set(provider, group)
      groups.push(group)
    }
    group.options.push(option)
  }
  return groups
}

function enumOptions(prop: SchemaProperty): Array<string> {
  return (prop.enum ?? []).map((v) => String(v))
}

function selectedEnumValue(
  item: InlineSchemaProperty,
  args: Readonly<Record<string, unknown>>
): string {
  const current = args[item.key]
  if (current !== undefined && current !== null && current !== ``) {
    return String(current)
  }
  if (item.prop.default !== undefined && item.prop.default !== null) {
    return String(item.prop.default)
  }
  const first = item.prop.enum?.[0]
  return first !== undefined && first !== null ? String(first) : ``
}

function enumOptionLabel(value: string): string {
  return value
    .split(/[\s_-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(` `)
}

function ModelSettingsMenu({
  model,
  reasoning,
  speed,
  args,
  onChange,
  disabled,
}: {
  model: InlineSchemaProperty
  reasoning: InlineSchemaProperty
  speed?: InlineSchemaProperty
  args: Readonly<Record<string, unknown>>
  onChange: (key: string, prop: SchemaProperty, value: string) => void
  disabled?: boolean
}): React.ReactElement {
  const modelValue = selectedEnumValue(model, args)
  const reasoningValue = selectedEnumValue(reasoning, args)
  const speedValue = speed ? selectedEnumValue(speed, args) : ``
  const modelLabel = modelValue ? modelOptionLabel(modelValue) : `Model`
  const reasoningLabel = reasoningValue
    ? enumOptionLabel(reasoningValue)
    : `Auto`
  const speedLabel = speedValue ? enumOptionLabel(speedValue) : `Speed`
  const modelGroups = groupedModelOptions(enumOptions(model.prop))

  return (
    <Menu.Root>
      <Menu.Trigger
        disabled={disabled}
        render={(triggerProps) => (
          <Tooltip content="Model" side="top" align="start">
            <button
              {...triggerProps}
              type="button"
              className={[triggerProps.className, styles.modelSettingsTrigger]
                .filter(Boolean)
                .join(` `)}
              aria-label="Model and reasoning"
              disabled={disabled}
            >
              <span className={styles.modelSettingsTriggerModel}>
                {modelLabel}
              </span>
              <span className={styles.modelSettingsTriggerMeta}>
                {reasoningLabel}
              </span>
              <Icon
                icon={ChevronDown}
                size={1}
                className={styles.modelSettingsChevron}
              />
            </button>
          </Tooltip>
        )}
      />
      <Menu.Content
        side="top"
        align="start"
        sideOffset={8}
        className={styles.modelSettingsMenu}
      >
        <Menu.SubmenuRoot>
          <Menu.SubmenuTrigger className={styles.modelSettingsSubmenuTrigger}>
            <span>Model</span>
            <span className={styles.modelSettingsSubmenuValue}>
              {modelLabel}
            </span>
            <Icon
              icon={ChevronRight}
              size={2}
              className={styles.modelSettingsChevron}
            />
          </Menu.SubmenuTrigger>
          <Menu.Content
            side="right"
            align="start"
            className={styles.modelSettingsModelMenu}
          >
            {modelGroups.map((group) => (
              <Menu.Group key={group.provider}>
                <Menu.Label>{group.label}</Menu.Label>
                {group.options.map((option) => {
                  const active = option === modelValue
                  return (
                    <Menu.Item
                      key={option}
                      onSelect={() => onChange(model.key, model.prop, option)}
                    >
                      <span className={styles.modelSettingsItemLabel}>
                        {modelOptionLabel(option)}
                      </span>
                      {active && (
                        <Icon
                          icon={Check}
                          size={2}
                          className={styles.modelSettingsActiveMark}
                        />
                      )}
                    </Menu.Item>
                  )
                })}
              </Menu.Group>
            ))}
          </Menu.Content>
        </Menu.SubmenuRoot>

        <Menu.SubmenuRoot>
          <Menu.SubmenuTrigger className={styles.modelSettingsSubmenuTrigger}>
            <span>Reasoning</span>
            <span className={styles.modelSettingsSubmenuValue}>
              {reasoningLabel}
            </span>
            <Icon
              icon={ChevronRight}
              size={2}
              className={styles.modelSettingsChevron}
            />
          </Menu.SubmenuTrigger>
          <Menu.Content side="right" align="start">
            {enumOptions(reasoning.prop).map((option) => {
              const active = option === reasoningValue
              return (
                <Menu.Item
                  key={option}
                  onSelect={() =>
                    onChange(reasoning.key, reasoning.prop, option)
                  }
                >
                  <span className={styles.modelSettingsItemLabel}>
                    {enumOptionLabel(option)}
                  </span>
                  {active && (
                    <Icon
                      icon={Check}
                      size={2}
                      className={styles.modelSettingsActiveMark}
                    />
                  )}
                </Menu.Item>
              )
            })}
          </Menu.Content>
        </Menu.SubmenuRoot>

        {speed && (
          <Menu.SubmenuRoot>
            <Menu.SubmenuTrigger className={styles.modelSettingsSubmenuTrigger}>
              <span>Speed</span>
              <span className={styles.modelSettingsSubmenuValue}>
                {speedLabel}
              </span>
              <Icon
                icon={ChevronRight}
                size={2}
                className={styles.modelSettingsChevron}
              />
            </Menu.SubmenuTrigger>
            <Menu.Content side="right" align="start">
              {enumOptions(speed.prop).map((option) => {
                const active = option === speedValue
                return (
                  <Menu.Item
                    key={option}
                    onSelect={() => onChange(speed.key, speed.prop, option)}
                  >
                    <span className={styles.modelSettingsItemLabel}>
                      {enumOptionLabel(option)}
                    </span>
                    {active && (
                      <Icon
                        icon={Check}
                        size={2}
                        className={styles.modelSettingsActiveMark}
                      />
                    )}
                  </Menu.Item>
                )
              })}
            </Menu.Content>
          </Menu.SubmenuRoot>
        )}
      </Menu.Content>
    </Menu.Root>
  )
}

function PillSelect({
  label,
  value,
  options,
  groupByProvider = false,
  optionLabels,
  onChange,
  disabled,
}: {
  label: string
  value: string
  options: Array<string>
  groupByProvider?: boolean
  optionLabels?: Record<string, string>
  onChange: (value: string) => void
  disabled?: boolean
}): React.ReactElement {
  const groups = groupByProvider ? groupedModelOptions(options) : []
  return (
    <Select.Root<string>
      value={value}
      onValueChange={(v) => {
        if (v !== null) onChange(v)
      }}
      disabled={disabled}
    >
      <Select.Trigger
        size="pill"
        aria-label={label}
        tooltip={label}
        renderValue={
          groupByProvider
            ? (current) => (current ? modelOptionLabel(current) : label)
            : optionLabels
              ? (v) => (v ? (optionLabels[v] ?? v) : v)
              : undefined
        }
      />
      <Select.Content>
        {groupByProvider
          ? groups.map((group) => (
              <Select.Group key={group.provider}>
                <Select.GroupLabel>{group.label}</Select.GroupLabel>
                {group.options.map((opt) => (
                  <Select.Item key={opt} value={opt}>
                    {modelOptionLabel(opt)}
                  </Select.Item>
                ))}
              </Select.Group>
            ))
          : options.map((opt) => (
              <Select.Item key={opt} value={opt}>
                {optionLabels?.[opt] ?? opt}
              </Select.Item>
            ))}
      </Select.Content>
    </Select.Root>
  )
}

function PillToggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={[
        styles.pill,
        styles.pillButton,
        checked ? styles.pillButtonActive : null,
      ]
        .filter(Boolean)
        .join(` `)}
      aria-pressed={checked}
    >
      {label}
    </button>
  )
}
