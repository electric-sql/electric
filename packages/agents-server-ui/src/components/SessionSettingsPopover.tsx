/**
 * Shared composer-settings strip.
 *
 * Renders the same inline controls row that appears at the bottom of
 * the new-session composer (model pills + CWD picker), so active
 * sessions can change their working directory and model params at any
 * point — not just when first spawning.
 *
 * Used by:
 *   - MessageInput  → PATCHes spawn_args on change so the agent picks
 *     them up on the next wake
 *   - NewSessionView → used as pure local state, passed into spawn args
 */

import { useCallback, useMemo } from 'react'
import { Select } from '../ui'
import { WorkingDirectoryPicker } from './WorkingDirectoryPicker'
import { useRecentWorkingDirectories } from '../hooks/useRecentWorkingDirectories'
import newSessionStyles from './NewSessionPage.module.css'
import type { ElectricEntity, ElectricEntityType } from '../lib/ElectricAgentsProvider'

// ---------------------------------------------------------------
// Shared schema-introspection helpers
// (Also imported by NewSessionView so there's one source of truth)
// ---------------------------------------------------------------

export interface SchemaProperty {
  type?: string
  enum?: Array<unknown>
  default?: unknown
  title?: string
  description?: string
}

export function isObjectSchema(
  schema: unknown
): schema is { properties: Record<string, unknown> } {
  return (
    typeof schema === `object` &&
    schema !== null &&
    `properties` in schema &&
    typeof (schema as Record<string, unknown>).properties === `object`
  )
}

/**
 * Returns all enum + boolean fields from a JSON Schema object, in
 * declaration order. `workingDirectory` is excluded here because it is
 * always surfaced via the dedicated CWD picker rather than a generic pill.
 */
export function inlineSchemaProperties(
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

export function isModelProperty(key: string): boolean {
  const normalized = key.toLowerCase()
  return (
    normalized === `model` ||
    normalized === `modelid` ||
    normalized === `model_id`
  )
}

const LAST_PICKED_MODEL_STORAGE_KEY = `electric-agents-ui.new-session.last-picked-model`

export function readLastPickedModel(options: Array<string>): string | null {
  if (typeof window === `undefined`) return null
  try {
    const value = window.localStorage.getItem(LAST_PICKED_MODEL_STORAGE_KEY)
    return value && options.includes(value) ? value : null
  } catch {
    return null
  }
}

export function persistLastPickedModel(value: string): void {
  if (typeof window === `undefined`) return
  try {
    window.localStorage.setItem(LAST_PICKED_MODEL_STORAGE_KEY, value)
  } catch {
    // Quota / private mode — silent.
  }
}

// ---------------------------------------------------------------
// Pill sub-components (shared between new-session and active-session
// composers so both have identical visual treatment)
// ---------------------------------------------------------------

export function PillSelect({
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

export function PillToggle({
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
        newSessionStyles.pill,
        newSessionStyles.pillButton,
        checked ? newSessionStyles.pillButtonActive : null,
      ]
        .filter(Boolean)
        .join(` `)}
      aria-pressed={checked}
    >
      {label}
    </button>
  )
}

// ---------------------------------------------------------------
// Inline settings strip — for active sessions in MessageInput
// ---------------------------------------------------------------

/**
 * Reads current values from `entity.spawn_args`, renders the same
 * pill + CWD controls as the new-session composer footer, and PATCHes
 * spawn_args on every change so the agent picks them up next wake.
 */
export function ComposerSettings({
  entity,
  entityType,
  baseUrl,
  disabled,
}: {
  entity: ElectricEntity
  entityType: ElectricEntityType | null
  baseUrl: string
  disabled?: boolean
}): React.ReactElement {
  const { addRecent } = useRecentWorkingDirectories()

  const inlineProps = useMemo(
    () => inlineSchemaProperties(entityType?.creation_schema),
    [entityType]
  )

  const currentArgs: Record<string, unknown> = entity.spawn_args ?? {}

  const patch = useCallback(
    async (updated: Record<string, unknown>) => {
      try {
        await fetch(`${baseUrl}${entity.url}`, {
          method: `PATCH`,
          headers: { 'content-type': `application/json` },
          body: JSON.stringify({ args: updated }),
        })
      } catch {
        // Best-effort — if the server is unreachable the entity's
        // spawn_args will be stale but we don't surface an error here
        // because the user is in the middle of typing.
      }
    },
    [baseUrl, entity.url]
  )

  const handleFieldChange = useCallback(
    (key: string, value: unknown) => {
      void patch({ ...currentArgs, [key]: value })
    },
    [currentArgs, patch]
  )

  const handleCwdChange = useCallback(
    (path: string | null) => {
      const next = { ...currentArgs }
      if (path === null) {
        delete next.workingDirectory
      } else {
        next.workingDirectory = path
        addRecent(path)
      }
      void patch(next)
    },
    [currentArgs, patch, addRecent]
  )

  const currentCwd =
    typeof currentArgs.workingDirectory === `string`
      ? currentArgs.workingDirectory
      : null

  return (
    <>
      {inlineProps.map(({ key, prop }) =>
        prop.enum ? (
          <PillSelect
            key={key}
            label={prop.title ?? key}
            value={String(currentArgs[key] ?? prop.default ?? prop.enum[0] ?? ``)}
            options={prop.enum.map((v) => String(v))}
            onChange={(next) => {
              const original = prop.enum!.find((v) => String(v) === next)
              if (isModelProperty(key)) persistLastPickedModel(next)
              handleFieldChange(key, original ?? next)
            }}
            disabled={disabled}
          />
        ) : prop.type === `boolean` ? (
          <PillToggle
            key={key}
            label={prop.title ?? key}
            checked={Boolean(currentArgs[key])}
            onChange={(checked) => handleFieldChange(key, checked)}
            disabled={disabled}
          />
        ) : null
      )}
      <WorkingDirectoryPicker
        value={currentCwd}
        onChange={handleCwdChange}
        disabled={disabled}
      />
    </>
  )
}
