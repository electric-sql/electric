import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUp,
  Check,
  ChevronDown,
  FolderOpen,
  FolderPlus,
} from 'lucide-react'
import { useLiveQuery } from '@tanstack/react-db'
import { eq, not } from '@tanstack/db'
import { useNavigate } from '@tanstack/react-router'
import { nanoid } from 'nanoid'
import { useElectricAgents } from '../lib/ElectricAgentsProvider'
import { useServerConnection } from '../hooks/useServerConnection'
import { useProjects } from '../hooks/useProjects'
import { Popover, Select, Stack, Text } from '../ui'
import { MainHeader } from './MainHeader'
import { SchemaForm, hasSchemaProperties, isObjectSchema } from './SchemaForm'
import styles from './NewSessionPage.module.css'
import type { ElectricEntityType } from '../lib/ElectricAgentsProvider'
import type { Project } from '../hooks/useProjects'

const DEFAULT_AGENT_NAME = `horton`

interface SchemaProperty {
  type?: string
  enum?: Array<unknown>
  default?: unknown
  title?: string
  description?: string
}

export function NewSessionPage(): React.ReactElement {
  const navigate = useNavigate()
  const { entityTypesCollection, spawnEntity } = useElectricAgents()
  const { activeServer } = useServerConnection()
  const {
    projects,
    activeProjectId,
    setActiveProjectId,
    createProject,
    validatePath,
  } = useProjects()
  const [selected, setSelected] = useState<ElectricEntityType | null>(null)
  const [error, setError] = useState<string | null>(null)

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId]
  )

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
      const spawnArgs = activeProject?.path
        ? { ...args, workingDirectory: activeProject.path }
        : args
      const tx = spawnEntity({
        type: typeName,
        name,
        args: spawnArgs,
        tags,
      })
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
    [navigate, spawnEntity, baseUrl, activeProjectId, activeProject]
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
              activeProject={activeProject}
              onChangeProject={setActiveProjectId}
              onCreateProject={createProject}
              onValidatePath={validatePath}
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
  activeProject,
  onChangeProject,
  onCreateProject,
  onValidatePath,
}: {
  defaultAgent: ElectricEntityType | null
  otherAgents: Array<ElectricEntityType>
  onSelectType: (t: ElectricEntityType) => void
  onStartDefault: (text: string, args: Record<string, unknown>) => void
  spawnReady: boolean
  error: string | null
  projects: Array<Project>
  activeProject: Project | null
  onChangeProject: (id: string | null) => void
  onCreateProject: (name: string, path: string) => Promise<Project>
  onValidatePath: (
    path: string
  ) => Promise<{ valid: boolean; resolved: string }>
}): React.ReactElement {
  const hasAnyAgent = defaultAgent !== null || otherAgents.length > 0

  return (
    <Stack direction="column" gap={5} style={{ width: `100%` }}>
      <div className={styles.heading}>
        <Text size={5} as="h1" className={styles.headingTitle}>
          Let&rsquo;s build
        </Text>
        <ProjectPicker
          projects={projects}
          activeProject={activeProject}
          onChangeProject={onChangeProject}
          onCreateProject={onCreateProject}
          onValidatePath={onValidatePath}
        />
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

function ProjectPicker({
  projects,
  activeProject,
  onChangeProject,
  onCreateProject,
  onValidatePath,
}: {
  projects: Array<Project>
  activeProject: Project | null
  onChangeProject: (id: string | null) => void
  onCreateProject: (name: string, path: string) => Promise<Project>
  onValidatePath: (
    path: string
  ) => Promise<{ valid: boolean; resolved: string }>
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState(``)
  const [newPath, setNewPath] = useState(``)
  const [pathError, setPathError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  const resetForm = useCallback(() => {
    setCreating(false)
    setNewName(``)
    setNewPath(``)
    setPathError(null)
  }, [])

  const handleCreate = useCallback(async () => {
    const trimmedName = newName.trim()
    const trimmedPath = newPath.trim()
    if (!trimmedName || !trimmedPath) return

    setSubmitting(true)
    setPathError(null)
    try {
      const validation = await onValidatePath(trimmedPath)
      if (!validation.valid) {
        setPathError(`Not a valid directory`)
        setSubmitting(false)
        return
      }
      const project = await onCreateProject(trimmedName, trimmedPath)
      onChangeProject(project.id)
      resetForm()
      setOpen(false)
    } catch (err) {
      setPathError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }, [
    newName,
    newPath,
    onValidatePath,
    onCreateProject,
    onChangeProject,
    resetForm,
  ])

  return (
    <Popover.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) resetForm()
      }}
    >
      <Popover.Trigger
        render={
          <button type="button" className={styles.projectTrigger}>
            {activeProject?.name ?? `Select a project`}
            <ChevronDown
              size={20}
              className={styles.projectTriggerChevron}
              data-open={open}
            />
          </button>
        }
      />
      <Popover.Content
        side="bottom"
        align="center"
        sideOffset={4}
        padded={false}
        className={styles.projectPopover}
      >
        <div className={styles.projectPopoverHeader}>Select your project</div>

        {projects.map((p) => (
          <button
            key={p.id}
            type="button"
            className={styles.projectItem}
            onClick={() => {
              onChangeProject(p.id)
              setOpen(false)
            }}
          >
            <FolderOpen size={14} className={styles.projectItemIcon} />
            {p.name}
            {p.id === activeProject?.id && (
              <Check size={14} className={styles.projectItemCheck} />
            )}
          </button>
        ))}

        {!creating ? (
          <button
            type="button"
            className={styles.projectItem}
            onClick={() => {
              setCreating(true)
              setTimeout(() => nameRef.current?.focus(), 0)
            }}
          >
            <FolderPlus size={14} className={styles.projectItemIcon} />
            Add new project
          </button>
        ) : (
          <form
            className={styles.projectCreateInline}
            onSubmit={(e) => {
              e.preventDefault()
              void handleCreate()
            }}
          >
            <input
              ref={nameRef}
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Project name"
              className={styles.projectCreateInput}
              onKeyDown={(e) => {
                if (e.key === `Escape`) resetForm()
              }}
            />
            <div className={styles.projectCreateRow}>
              <input
                type="text"
                value={newPath}
                onChange={(e) => {
                  setNewPath(e.target.value)
                  setPathError(null)
                }}
                placeholder="/path/to/project"
                className={styles.projectPathInput}
                onKeyDown={(e) => {
                  if (e.key === `Escape`) resetForm()
                }}
              />
              <button
                type="submit"
                disabled={!newName.trim() || !newPath.trim() || submitting}
                className={styles.projectCreateBtn}
              >
                {submitting ? `…` : `Create`}
              </button>
            </div>
            {pathError && (
              <span className={styles.projectPathError}>{pathError}</span>
            )}
          </form>
        )}
      </Popover.Content>
    </Popover.Root>
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

function inlineSchemaProperties(
  schema: unknown
): Array<{ key: string; prop: SchemaProperty }> {
  if (!isObjectSchema(schema)) return []
  const out: Array<{ key: string; prop: SchemaProperty }> = []
  for (const [key, raw] of Object.entries(schema.properties)) {
    const prop = raw as SchemaProperty
    if (key === `workingDirectory`) continue
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
