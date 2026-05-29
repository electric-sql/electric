import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ArrowUp, Cpu, Sparkles } from 'lucide-react'
import { eq, not, useLiveQuery } from '@tanstack/react-db'
import { nanoid } from 'nanoid'
import { useElectricAgents } from '../../lib/ElectricAgentsProvider'
import { useWorkspace } from '../../hooks/useWorkspace'
import { useRecentWorkingDirectories } from '../../hooks/useRecentWorkingDirectories'
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
import { Button, Icon, Select, Stack, Text } from '../../ui'
import { SchemaForm, hasSchemaProperties, isObjectSchema } from '../SchemaForm'
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
import styles from '../NewSessionPage.module.css'
import type {
  ElectricEntityType,
  ElectricRunner,
} from '../../lib/ElectricAgentsProvider'
import type { StandaloneViewProps } from '../../lib/workspace/viewRegistry'

/**
 * The "default agent" — when an entity type with this name is registered
 * we surface a chat-input quick-start at the top of the new-session view
 * so the most common flow is one keystroke away.
 */
const DEFAULT_AGENT_NAME = `horton`

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

interface SchemaProperty {
  type?: string
  enum?: Array<unknown>
  default?: unknown
  title?: string
  description?: string
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
  const { entityTypesCollection, runnersCollection, spawnEntity } =
    useElectricAgents()
  const { helpers } = useWorkspace()
  const [selected, setSelected] = useState<ElectricEntityType | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { recents: recentDirs, addRecent: addRecentDir } =
    useRecentWorkingDirectories()
  // Default to the most-recently-used working directory so a user
  // who keeps opening sessions against the same project root doesn't
  // have to re-select it each time. Initialised lazily so subsequent
  // additions to `recents` don't yank the picker out from under the
  // user mid-edit.
  const [workingDirectory, setWorkingDirectory] = useState<string | null>(
    () => recentDirs[0] ?? null
  )

  const { data: entityTypes = [] } = useLiveQuery(
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

  const { data: enabledRunners = [] } = useLiveQuery(
    (query) => {
      if (!runnersCollection) return undefined
      return query
        .from({ r: runnersCollection })
        .where(({ r }) => eq(r.admin_status, `enabled`))
        .orderBy(({ r }) => r.label, `asc`)
    },
    [runnersCollection]
  )

  // The Electron shell registers its own pull-wake runner. When that
  // runner is one of the available choices we prefer it as the default
  // selection (preserves the old desktop behaviour of routing wakes to
  // the bundled local runtime). `null` outside Electron / before the
  // first state fetch.
  const [desktopRunnerId, setDesktopRunnerId] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void loadDesktopState().then((s) => {
      if (cancelled) return
      setDesktopRunnerId(s?.pullWakeRunnerId?.trim() || null)
    })
    const off = onDesktopStateChanged((s) =>
      setDesktopRunnerId(s?.pullWakeRunnerId?.trim() || null)
    )
    return () => {
      cancelled = true
      off?.()
    }
  }, [])

  const [selectedRunnerId, setSelectedRunnerId] = useState<string | null>(null)
  // Re-evaluate the default whenever the list of runners or the
  // desktop's runner id changes. Prefer the desktop's own runner if
  // it's enabled, else fall back to the first runner.
  useEffect(() => {
    if (
      selectedRunnerId &&
      enabledRunners.some((r) => r.id === selectedRunnerId)
    ) {
      return
    }
    if (enabledRunners.length === 0) {
      if (selectedRunnerId !== null) setSelectedRunnerId(null)
      return
    }
    if (
      desktopRunnerId &&
      enabledRunners.some((r) => r.id === desktopRunnerId)
    ) {
      setSelectedRunnerId(desktopRunnerId)
      return
    }
    setSelectedRunnerId(enabledRunners[0]!.id)
  }, [enabledRunners, desktopRunnerId, selectedRunnerId])

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
      initialUserText?: string,
      initialAttachments?: Array<File>
    ) => {
      if (!spawnEntity) return
      setError(null)
      const name = nanoid(10)
      const hasInitialAttachments =
        initialAttachments !== undefined && initialAttachments.length > 0
      const initialText = initialUserText?.trim() ?? ``
      const tx = spawnEntity({
        type: typeName,
        name,
        args,
        ...(selectedRunnerId
          ? {
              dispatch_policy: {
                targets: [
                  { type: `runner` as const, runnerId: selectedRunnerId },
                ],
              },
            }
          : {}),
        ...(initialText && !hasInitialAttachments
          ? { initialMessage: initialText }
          : {}),
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
        })
      } catch (err) {
        setError(
          `Could not start session: ${err instanceof Error ? err.message : String(err)}.`
        )
      }
    },
    [baseUrl, helpers, selectedRunnerId, spawnEntity, tileId]
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

  const handleStartDefault = useCallback(
    (text: string, args: Record<string, unknown>, attachments: Array<File>) => {
      if (!defaultAgent) return
      // Inject the picker's choice into the spawn args for the
      // composer flow only — non-default agents have their own
      // schemas and may not understand `workingDirectory`. Also
      // remember the chosen path so the next session opens with the
      // same default.
      const augmented =
        workingDirectory !== null ? { ...args, workingDirectory } : args
      if (workingDirectory !== null) addRecentDir(workingDirectory)
      void doSpawn(defaultAgent.name, augmented, text, attachments)
    },
    [defaultAgent, doSpawn, workingDirectory, addRecentDir]
  )

  return (
    <div className={styles.body}>
      <div className={styles.container}>
        {selected ? (
          <SelectedAgentForm
            entityType={selected}
            onCancel={handleCancelSelected}
            onSubmit={(args) => void doSpawn(selected.name, args)}
            error={error}
          />
        ) : (
          <Picker
            defaultAgent={defaultAgent}
            otherAgents={otherAgents}
            onSelectType={handleSelectType}
            onStartDefault={handleStartDefault}
            spawnReady={Boolean(spawnEntity)}
            error={error}
            workingDirectory={workingDirectory}
            onChangeWorkingDirectory={setWorkingDirectory}
            runners={enabledRunners}
            selectedRunnerId={selectedRunnerId}
            onChangeSelectedRunner={setSelectedRunnerId}
          />
        )}
      </div>
    </div>
  )
}

function Picker({
  defaultAgent,
  otherAgents,
  onSelectType,
  onStartDefault,
  spawnReady,
  error,
  workingDirectory,
  onChangeWorkingDirectory,
  runners,
  selectedRunnerId,
  onChangeSelectedRunner,
}: {
  defaultAgent: ElectricEntityType | null
  otherAgents: Array<ElectricEntityType>
  onSelectType: (t: ElectricEntityType) => void
  onStartDefault: (
    text: string,
    args: Record<string, unknown>,
    attachments: Array<File>
  ) => void
  spawnReady: boolean
  error: string | null
  workingDirectory: string | null
  onChangeWorkingDirectory: (path: string | null) => void
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
          onSubmit={onStartDefault}
          disabled={!spawnReady}
          workingDirectory={workingDirectory}
          onChangeWorkingDirectory={onChangeWorkingDirectory}
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
  onCancel,
  onSubmit,
  error,
}: {
  entityType: ElectricEntityType
  onCancel: () => void
  onSubmit: (args: Record<string, unknown>) => void
  error: string | null
}): React.ReactElement {
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
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      </div>
    </Stack>
  )
}

function inlineSchemaProperties(
  schema: unknown
): Array<{ key: string; prop: SchemaProperty }> {
  if (!isObjectSchema(schema)) return []
  const out: Array<{ key: string; prop: SchemaProperty }> = []
  for (const [key, raw] of Object.entries(schema.properties)) {
    const prop = raw as SchemaProperty
    if (prop.enum && prop.enum.length > 0) {
      out.push({ key, prop })
    } else if (prop.type === `boolean`) {
      out.push({ key, prop })
    }
  }
  return out
}

function DefaultAgentComposer({
  agent,
  onSubmit,
  disabled,
  workingDirectory,
  onChangeWorkingDirectory,
  runners,
  selectedRunnerId,
  onChangeSelectedRunner,
}: {
  agent: ElectricEntityType
  onSubmit: (
    text: string,
    args: Record<string, unknown>,
    attachments: Array<File>
  ) => void
  disabled?: boolean
  workingDirectory: string | null
  onChangeWorkingDirectory: (path: string | null) => void
  runners: Array<ElectricRunner>
  selectedRunnerId: string | null
  onChangeSelectedRunner: (id: string | null) => void
}): React.ReactElement {
  const [value, setValue] = useState(``)
  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inlineProps = useMemo(
    () => inlineSchemaProperties(agent.creation_schema),
    [agent.creation_schema]
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
    focusRef: textareaRef,
  })

  useEffect(() => {
    if (!imageAttachmentsEnabled) clearAttachments()
  }, [imageAttachmentsEnabled, clearAttachments])

  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = `auto`
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  const submit = useCallback(() => {
    const trimmed = value.trim()
    const files = imageAttachmentsEnabled ? attachments : []
    if ((!trimmed && files.length === 0) || disabled || submitting) {
      return
    }
    setSubmitting(true)
    const cleaned: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(args)) {
      if (v !== undefined && v !== ``) cleaned[k] = v
    }
    onSubmit(trimmed, cleaned, files)
    clearAttachments()
  }, [
    args,
    attachments,
    imageAttachmentsEnabled,
    clearAttachments,
    disabled,
    onSubmit,
    submitting,
    value,
  ])

  const attachmentCount = imageAttachmentsEnabled ? attachments.length : 0
  const isActive = Boolean(
    (value.trim() || attachmentCount > 0) && !disabled && !submitting
  )
  const placeholder = disabled ? `Connecting…` : `Ask ${agent.name} anything…`

  return (
    <div
      className={[
        styles.composerWrap,
        disabled ? styles.composerDisabled : null,
      ]
        .filter(Boolean)
        .join(` `)}
    >
      <div
        className={[
          styles.composer,
          dropActive ? styles.composerDropActive : null,
        ]
          .filter(Boolean)
          .join(` `)}
        {...dropZoneProps}
      >
        {imageAttachmentsEnabled && (
          <AttachmentPreviewTray
            attachments={attachments}
            onRemove={removeAttachment}
          />
        )}
        <textarea
          ref={textareaRef}
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            if (e.key === `Enter` && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={placeholder}
          disabled={disabled || submitting}
          rows={1}
          className={styles.composerTextarea}
        />
        <div className={styles.composerFooter}>
          <div className={styles.composerControls}>
            {imageAttachmentsEnabled && (
              <AttachmentActionMenu
                disabled={disabled || submitting}
                accept={imageAttachmentDraftPolicy.accept}
                fileInputRef={fileInputRef}
                onFilesSelected={addAttachments}
                onAttach={openAttachmentPicker}
              />
            )}
            {inlineProps.map(({ key, prop }) =>
              prop.enum ? (
                <PillSelect
                  key={key}
                  label={prop.title ?? key}
                  value={String(args[key] ?? ``)}
                  options={prop.enum.map((v) => String(v))}
                  groupByProvider={isModelProperty(key)}
                  onChange={(next) => {
                    const original = prop.enum!.find((v) => String(v) === next)
                    if (isModelProperty(key)) persistLastPickedModel(next)
                    setArgs((prev) => ({ ...prev, [key]: original ?? next }))
                  }}
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
          </div>
          <div className={styles.composerSendCluster}>
            {submitting && (
              <span className={styles.composerHint}>Starting…</span>
            )}
            <button
              type="button"
              aria-label={`Start ${agent.name} session`}
              onClick={submit}
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
          </div>
        </div>
      </div>
      <div className={styles.composerMeta}>
        <WorkingDirectoryPicker
          value={workingDirectory}
          onChange={onChangeWorkingDirectory}
          disabled={submitting || disabled}
        />
        {runners.length > 0 && (
          <RunnerPickerPill
            runners={runners}
            value={selectedRunnerId}
            onChange={onChangeSelectedRunner}
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
        title="Pull-wake runner that will handle this session"
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

const MODEL_PROVIDER_LABELS: Record<string, string> = {
  anthropic: `Anthropic`,
  openai: `OpenAI`,
  'openai-codex': `OpenAI Codex`,
  deepseek: `DeepSeek`,
  moonshot: `Kimi`,
}

function modelProviderKey(value: string): string {
  const index = value.indexOf(`:`)
  return index > 0 ? value.slice(0, index) : `other`
}

function modelProviderLabel(provider: string): string {
  return MODEL_PROVIDER_LABELS[provider] ?? provider
}

function modelOptionLabel(value: string): string {
  const index = value.indexOf(`:`)
  return index > 0 ? value.slice(index + 1) : value
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

function PillSelect({
  label,
  value,
  options,
  groupByProvider = false,
  onChange,
  disabled,
}: {
  label: string
  value: string
  options: Array<string>
  groupByProvider?: boolean
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
        title={label}
        renderValue={
          groupByProvider
            ? (current) => (current ? modelOptionLabel(current) : label)
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
                {opt}
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
