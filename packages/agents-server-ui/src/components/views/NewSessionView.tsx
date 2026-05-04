import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { useLiveQuery } from '@tanstack/react-db'
import { eq, not } from '@tanstack/db'
import { nanoid } from 'nanoid'
import { CODING_SESSION_ENTITY_TYPE } from '@electric-ax/agents-runtime'
import { useElectricAgents } from '../../lib/ElectricAgentsProvider'
import { useServerConnection } from '../../hooks/useServerConnection'
import { useWorkspace } from '../../hooks/useWorkspace'
import { Select, Stack, Text } from '../../ui'
import { SchemaForm, hasSchemaProperties, isObjectSchema } from '../SchemaForm'
import { CodingSessionSpawnForm } from '../CodingSessionSpawnForm'
import styles from '../NewSessionPage.module.css'
import type { ElectricEntityType } from '../../lib/ElectricAgentsProvider'
import type { StandaloneViewProps } from '../../lib/workspace/viewRegistry'

/**
 * The "default agent" — when an entity type with this name is registered
 * we surface a chat-input quick-start at the top of the new-session view
 * so the most common flow is one keystroke away.
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
  tileId,
}: StandaloneViewProps): React.ReactElement {
  const { entityTypesCollection, spawnEntity } = useElectricAgents()
  const { activeServer } = useServerConnection()
  const { helpers } = useWorkspace()
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
   *
   * On success we *replace this tile* with the freshly-created entity.
   * That keeps the workspace layout intact (other tiles around us
   * stay in place) and feels like opening a file in VS Code's
   * "untitled" tab — the placeholder turns into the new content.
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
      const initialMessage =
        typeName === CODING_SESSION_ENTITY_TYPE && !initialUserText
          ? { __bootstrap: true }
          : undefined
      const tx = spawnEntity({ type: typeName, name, args, initialMessage })
      const entityUrl = `/${typeName}/${name}`
      helpers.openEntity(entityUrl, {
        target: { tileId, position: `replace` },
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
    [helpers, spawnEntity, baseUrl, tileId]
  )

  const handleSelectType = useCallback(
    (entityType: ElectricEntityType) => {
      if (entityType.name === CODING_SESSION_ENTITY_TYPE) {
        setSelected(entityType)
        return
      }
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
}: {
  defaultAgent: ElectricEntityType | null
  otherAgents: Array<ElectricEntityType>
  onSelectType: (t: ElectricEntityType) => void
  onStartDefault: (text: string, args: Record<string, unknown>) => void
  spawnReady: boolean
  error: string | null
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
        {entityType.name === CODING_SESSION_ENTITY_TYPE ? (
          <CodingSessionSpawnForm onSubmit={onSubmit} onCancel={onCancel} />
        ) : (
          <SchemaForm
            schema={entityType.creation_schema}
            submitLabel="Create"
            onSubmit={onSubmit}
            onCancel={onCancel}
          />
        )}
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
}: {
  agent: ElectricEntityType
  onSubmit: (text: string, args: Record<string, unknown>) => void
  disabled?: boolean
}): React.ReactElement {
  const [value, setValue] = useState(``)
  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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
