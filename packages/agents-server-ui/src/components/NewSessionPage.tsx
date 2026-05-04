import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { useLiveQuery } from '@tanstack/react-db'
import { eq, not } from '@tanstack/db'
import { useNavigate } from '@tanstack/react-router'
import { nanoid } from 'nanoid'
import { useElectricAgents } from '../lib/ElectricAgentsProvider'
import { useServerConnection } from '../hooks/useServerConnection'
import { useProjects } from '../hooks/useProjects'
import { Select, Stack, Text } from '../ui'
import { MainHeader } from './MainHeader'
import { SchemaForm, hasSchemaProperties, isObjectSchema } from './SchemaForm'
import styles from './NewSessionPage.module.css'
import type { ElectricEntityType } from '../lib/ElectricAgentsProvider'

/**
 * The "default agent" — when an entity type with this name is registered
 * we surface a chat-input quick-start at the top of the new-session page
 * so the most common flow is one keystroke away.
 *
 * TODO: replace this with a server-side flag (e.g. tags.default) once
 * the entity_types schema gets one.
 */
const DEFAULT_AGENT_NAME = `horton`

interface SchemaProperty {
  type?: string
  enum?: Array<unknown>
  default?: unknown
  title?: string
  description?: string
}

/**
 * "New session" page shown at `/`.
 *
 * If a `horton` entity type is available we render a chat-style
 * composer at the top of the page so the user can just type and hit
 * Enter to start a new conversation. Other agent types are listed
 * below as cards. Picking one of those either spawns immediately
 * (no schema) or transitions to an inline form.
 */
export function NewSessionPage(): React.ReactElement {
  const navigate = useNavigate()
  const { entityTypesCollection, spawnEntity } = useElectricAgents()
  const { activeServer } = useServerConnection()
  const { projects, activeProjectId, setActiveProjectId, createProject } =
    useProjects()
  const [selected, setSelected] = useState<ElectricEntityType | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: entityTypes = [] } = useLiveQuery(
    (query) => {
      if (!entityTypesCollection) return undefined
      return query
        .from({ t: entityTypesCollection })
        .where(({ t }) => not(eq(t.name, `worker`)))
        .orderBy(({ t }) => t.name, `asc`)
    },
    [entityTypesCollection]
  )

  const defaultAgent = useMemo(
    () => entityTypes.find((t) => t.name === DEFAULT_AGENT_NAME) ?? null,
    [entityTypes]
  )
  const otherAgents = useMemo(
    () => entityTypes.filter((t) => t.name !== DEFAULT_AGENT_NAME),
    [entityTypes]
  )

  const baseUrl = activeServer?.url ?? null

  /**
   * Spawn an entity, optionally followed by a `/send` of an initial
   * user message. We prefer this two-step over `initialMessage` on
   * spawn so the message goes through the same path as the regular
   * MessageInput (which is the proven path that wakes horton).
   */
  const doSpawn = useCallback(
    async (
      typeName: string,
      args?: Record<string, unknown>,
      initialUserText?: string
    ) => {
      if (!spawnEntity) return
      setError(null)
      const name = nanoid(10)
      const tags: Record<string, string> | undefined = activeProjectId
        ? { project: activeProjectId }
        : undefined
      const tx = spawnEntity({ type: typeName, name, args, tags })
      navigate({
        to: `/entity/$`,
        params: { _splat: `${typeName}/${name}` },
      })
      try {
        await tx.isPersisted.promise
        if (initialUserText && baseUrl) {
          const res = await fetch(`${baseUrl}/${typeName}/${name}/send`, {
            method: `POST`,
            headers: { 'content-type': `application/json` },
            body: JSON.stringify({
              from: `user`,
              payload: { text: initialUserText },
            }),
          })
          if (!res.ok) {
            const body = await res.text().catch(() => ``)
            throw new Error(body || `Send failed (${res.status})`)
          }
        }
      } catch (err) {
        setError(
          `Could not start session: ${err instanceof Error ? err.message : String(err)}. The server may be missing ANTHROPIC_API_KEY.`
        )
      }
    },
    [navigate, spawnEntity, baseUrl, activeProjectId]
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

  const handleStartDefault = useCallback(
    (text: string, args: Record<string, unknown>) => {
      if (!defaultAgent) return
      void doSpawn(defaultAgent.name, args, text)
    },
    [defaultAgent, doSpawn]
  )

  return (
    <div className={styles.shell}>
      <MainHeader title={<Text size={2}>New session</Text>} />
      <div className={styles.body}>
        <div className={styles.container}>
          {selected ? (
            <SelectedAgentForm
              entityType={selected}
              onCancel={() => setSelected(null)}
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
              projects={projects}
              activeProjectId={activeProjectId}
              onChangeProject={setActiveProjectId}
              onCreateProject={createProject}
            />
          )}
        </div>
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
  projects,
  activeProjectId,
  onChangeProject,
  onCreateProject,
}: {
  defaultAgent: ElectricEntityType | null
  otherAgents: Array<ElectricEntityType>
  onSelectType: (t: ElectricEntityType) => void
  onStartDefault: (text: string, args: Record<string, unknown>) => void
  spawnReady: boolean
  error: string | null
  projects: Array<{ id: string; name: string }>
  activeProjectId: string | null
  onChangeProject: (id: string | null) => void
  onCreateProject: (name: string) => { id: string }
}): React.ReactElement {
  const hasAnyAgent = defaultAgent !== null || otherAgents.length > 0

  return (
    <Stack direction="column" gap={5}>
      <div className={styles.heading}>
        <Text size={5} as="h1" className={styles.headingTitle}>
          Start a new session
        </Text>
        <span className={styles.headingSubtitle}>
          {defaultAgent
            ? `Type a message to start a new ${defaultAgent.name} chat, or pick another agent below.`
            : `Pick the kind of agent you want to spawn.`}
        </span>
      </div>

      <ProjectPicker
        projects={projects}
        activeProjectId={activeProjectId}
        onChangeProject={onChangeProject}
        onCreateProject={onCreateProject}
      />

      {error && <div className={styles.error}>{error}</div>}

      {defaultAgent && (
        <DefaultAgentComposer
          agent={defaultAgent}
          onSubmit={onStartDefault}
          disabled={!spawnReady}
        />
      )}

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
    <Stack direction="column" gap={4}>
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
          <button type="button" className={styles.backLink} onClick={onCancel}>
            ← Back
          </button>
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

/**
 * Walk the agent's `creation_schema` and pull out the keys we know how
 * to render inline as compact controls (enums and booleans). Other
 * fields fall through to schema defaults; if they're required without
 * a default, the user can switch to the full form via "Other agents".
 */
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
}: {
  agent: ElectricEntityType
  onSubmit: (text: string, args: Record<string, unknown>) => void
  disabled?: boolean
}): React.ReactElement {
  const [value, setValue] = useState(``)
  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-grow the textarea up to the CSS `max-height` cap as the
  // user types (matches the chat composer in `MessageInput.tsx`).
  // Reset to `auto` first so `scrollHeight` reports the natural
  // content height, then assign that back as the inline height; the
  // CSS bounds clamp it. Layout effect ensures the resize lands
  // before paint so there's no one-frame flicker.
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = `auto`
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  const inlineProps = useMemo(
    () => inlineSchemaProperties(agent.creation_schema),
    [agent.creation_schema]
  )
  const [args, setArgs] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {}
    for (const { key, prop } of inlineProps) {
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

  const submit = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || disabled || submitting) return
    setSubmitting(true)
    // Strip undefined/empty values so the server can fall back to schema
    // defaults instead of receiving an explicit empty/null.
    const cleaned: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(args)) {
      if (v !== undefined && v !== ``) cleaned[k] = v
    }
    onSubmit(trimmed, cleaned)
  }, [args, disabled, onSubmit, submitting, value])

  const isActive = Boolean(value.trim() && !disabled && !submitting)
  const placeholder = disabled ? `Connecting…` : `Ask ${agent.name} anything…`

  return (
    <div
      className={[styles.composer, disabled ? styles.composerDisabled : null]
        .filter(Boolean)
        .join(` `)}
    >
      <textarea
        ref={textareaRef}
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
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
          {inlineProps.map(({ key, prop }) =>
            prop.enum ? (
              <PillSelect
                key={key}
                label={prop.title ?? key}
                value={String(args[key] ?? ``)}
                options={prop.enum.map((v) => String(v))}
                onChange={(next) => {
                  const original = prop.enum!.find((v) => String(v) === next)
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
          {submitting && <span className={styles.composerHint}>Starting…</span>}
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
            <ArrowUp size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Tiny dropdown rendered as a borderless pill so it sits cleanly
 * in the composer footer without competing visually with the textarea.
 * Backed by the Base UI `Select` so we get a custom popover with proper
 * keyboard semantics (instead of the OS-native picker, which doesn't
 * blend with the rest of the surface).
 */
function PillSelect({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  value: string
  options: Array<string>
  onChange: (value: string) => void
  disabled?: boolean
}): React.ReactElement {
  return (
    <Select.Root<string>
      value={value}
      onValueChange={(v) => {
        if (v !== null) onChange(v)
      }}
      disabled={disabled}
    >
      <Select.Trigger size="pill" aria-label={label} title={label} />
      <Select.Content>
        {options.map((opt) => (
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

function ProjectPicker({
  projects,
  activeProjectId,
  onChangeProject,
  onCreateProject,
}: {
  projects: Array<{ id: string; name: string }>
  activeProjectId: string | null
  onChangeProject: (id: string | null) => void
  onCreateProject: (name: string) => { id: string }
}): React.ReactElement {
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState(``)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleCreate = useCallback(() => {
    const trimmed = newName.trim()
    if (!trimmed) return
    const project = onCreateProject(trimmed)
    onChangeProject(project.id)
    setNewName(``)
    setCreating(false)
  }, [newName, onCreateProject, onChangeProject])

  return (
    <div className={styles.projectPicker}>
      <Text size={1} tone="muted" className={styles.projectPickerLabel}>
        Project
      </Text>
      <div className={styles.projectPickerRow}>
        <Select.Root<string>
          value={activeProjectId ?? `__none__`}
          onValueChange={(v) => {
            if (v === `__new__`) {
              setCreating(true)
              setTimeout(() => inputRef.current?.focus(), 0)
            } else {
              onChangeProject(v === `__none__` ? null : v)
            }
          }}
        >
          <Select.Trigger size="pill" aria-label="Project" title="Project" />
          <Select.Content>
            <Select.Item value="__none__">No project</Select.Item>
            {projects.map((p) => (
              <Select.Item key={p.id} value={p.id}>
                {p.name}
              </Select.Item>
            ))}
            <Select.Item value="__new__">+ New project…</Select.Item>
          </Select.Content>
        </Select.Root>

        {creating && (
          <form
            className={styles.projectCreateForm}
            onSubmit={(e) => {
              e.preventDefault()
              handleCreate()
            }}
          >
            <input
              ref={inputRef}
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Project name"
              className={styles.projectCreateInput}
              onKeyDown={(e) => {
                if (e.key === `Escape`) {
                  setCreating(false)
                  setNewName(``)
                }
              }}
            />
            <button
              type="submit"
              disabled={!newName.trim()}
              className={styles.projectCreateBtn}
            >
              Create
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
