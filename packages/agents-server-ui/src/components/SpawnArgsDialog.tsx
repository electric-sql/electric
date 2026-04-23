import { useCallback, useMemo, useState } from 'react'
import { Button, Dialog, Flex, Text } from '@radix-ui/themes'
import type { ElectricEntityType } from '../lib/ElectricAgentsProvider'

interface SpawnArgsDialogProps {
  entityType: ElectricEntityType
  open: boolean
  onOpenChange: (open: boolean) => void
  onSpawn: (args: Record<string, unknown>) => void
}

interface SchemaProperty {
  type?: string
  enum?: Array<unknown>
  items?: { type?: string }
  title?: string
  description?: string
  default?: unknown
}

interface ObjectSchema {
  type?: string
  properties: Record<string, SchemaProperty>
  required?: Array<string>
}

export function isObjectSchema(schema: unknown): schema is ObjectSchema {
  if (!schema || typeof schema !== `object` || Array.isArray(schema))
    return false
  const s = schema as Record<string, unknown>
  return (
    s.properties != null &&
    typeof s.properties === `object` &&
    !Array.isArray(s.properties)
  )
}

export function hasSchemaProperties(schema: unknown): boolean {
  return isObjectSchema(schema) && Object.keys(schema.properties).length > 0
}

function isSimpleType(prop: SchemaProperty): boolean {
  if (prop.enum) return true
  return (
    prop.type === `string` ||
    prop.type === `number` ||
    prop.type === `integer` ||
    prop.type === `boolean`
  )
}

function isStringArrayType(prop: SchemaProperty): boolean {
  return prop.type === `array` && prop.items?.type === `string`
}

/**
 * Convert a display string to a string array.
 * Accepts either valid JSON array syntax (e.g. `["a", "b"]`) or
 * a comma-separated list (e.g. `a, b`).
 */
function parseStringArray(text: string): Array<string> {
  const trimmed = text.trim()
  if (trimmed === ``) return []
  // Try JSON parse first (handles ["a","b"] syntax)
  if (trimmed.startsWith(`[`)) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === `string`)) {
        return parsed
      }
    } catch {
      // Fall through to comma-separated parsing
    }
  }
  // Comma-separated fallback
  return trimmed
    .split(`,`)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Display a string array as comma-separated text for editing. */
function stringArrayToDisplay(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(String).join(`, `)
  }
  if (typeof value === `string`) return value
  return ``
}

export function SpawnArgsDialog({
  entityType,
  open,
  onOpenChange,
  onSpawn,
}: SpawnArgsDialogProps): React.ReactElement {
  const schema = entityType.creation_schema
  const objSchema = isObjectSchema(schema) ? schema : null

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>New {entityType.name}</Dialog.Title>
        {entityType.description && (
          <Dialog.Description size="2" color="gray" mb="4">
            {entityType.description}
          </Dialog.Description>
        )}
        {objSchema ? (
          <ObjectSchemaForm schema={objSchema} onSpawn={onSpawn} />
        ) : (
          <RawJsonForm onSpawn={onSpawn} />
        )}
      </Dialog.Content>
    </Dialog.Root>
  )
}

function ObjectSchemaForm({
  schema,
  onSpawn,
}: {
  schema: ObjectSchema
  onSpawn: (args: Record<string, unknown>) => void
}): React.ReactElement {
  const properties = schema.properties
  const requiredSet = useMemo(
    () => new Set(schema.required ?? []),
    [schema.required]
  )

  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const req = new Set(schema.required ?? [])
    const init: Record<string, unknown> = {}
    for (const [key, prop] of Object.entries(properties)) {
      if (prop.default !== undefined) {
        init[key] = prop.default
      } else if (req.has(key) && prop.enum && prop.enum.length > 0) {
        init[key] = prop.enum[0]
      } else if (req.has(key) && prop.type === `boolean`) {
        init[key] = false
      } else if (isStringArrayType(prop)) {
        init[key] = ``
      }
    }
    return init
  })

  const setValue = useCallback((key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }))
  }, [])

  const canSubmit = useMemo(() => {
    for (const key of requiredSet) {
      const v = values[key]
      if (v === undefined || v === null || v === ``) return false
      if (Array.isArray(v) && v.length === 0) return false
      // String-array fields are stored as a display string while editing
      const prop = properties[key] as SchemaProperty | undefined
      if (prop && isStringArrayType(prop) && typeof v === `string`) {
        if (parseStringArray(v).length === 0) return false
      }
    }
    return true
  }, [values, requiredSet, properties])

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      // Strip undefined/empty optional values
      const args: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(values)) {
        if (val !== undefined && val !== ``) {
          const prop = properties[key] as SchemaProperty | undefined
          // Convert string-array fields from display string to actual array
          if (prop && isStringArrayType(prop) && typeof val === `string`) {
            const arr = parseStringArray(val)
            if (arr.length > 0) {
              args[key] = arr
            }
          } else {
            args[key] = val
          }
        }
      }
      onSpawn(args)
    },
    [values, properties, onSpawn]
  )

  return (
    <form onSubmit={handleSubmit}>
      <Flex direction="column" gap="3">
        {Object.entries(properties).map(([key, prop], i) => (
          <SchemaField
            key={key}
            name={key}
            prop={prop}
            required={requiredSet.has(key)}
            value={values[key]}
            onChange={(v) => setValue(key, v)}
            autoFocus={i === 0}
          />
        ))}
      </Flex>
      <Flex gap="3" mt="4" justify="end">
        <Dialog.Close>
          <Button variant="soft" color="gray">
            Cancel
          </Button>
        </Dialog.Close>
        <Button type="submit" disabled={!canSubmit}>
          Create
        </Button>
      </Flex>
    </form>
  )
}

function SchemaField({
  name,
  prop,
  required,
  value,
  onChange,
  autoFocus,
}: {
  name: string
  prop: SchemaProperty
  required: boolean
  value: unknown
  onChange: (value: unknown) => void
  autoFocus?: boolean
}): React.ReactElement {
  const label = prop.title ?? name

  // String array: render comma-separated text input.
  // We store the raw text as a string while editing and convert
  // to a proper array at submit time (see handleSubmit).
  if (isStringArrayType(prop)) {
    return (
      <FieldWrapper
        label={label}
        required={required}
        description={prop.description}
      >
        <input
          type="text"
          value={stringArrayToDisplay(value)}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={autoFocus}
          placeholder={prop.description ?? `Comma-separated values`}
          style={inputStyle}
        />
        <Text size="1" color="gray">
          Separate multiple values with commas
        </Text>
      </FieldWrapper>
    )
  }

  if (!isSimpleType(prop)) {
    return (
      <FieldWrapper
        label={label}
        required={required}
        description={prop.description}
      >
        <textarea
          value={
            typeof value === `string`
              ? value
              : value !== undefined
                ? JSON.stringify(value, null, 2)
                : ``
          }
          onChange={(e) => {
            try {
              onChange(JSON.parse(e.target.value))
            } catch {
              onChange(e.target.value)
            }
          }}
          placeholder="JSON value"
          rows={3}
          autoFocus={autoFocus}
          style={textareaStyle}
        />
      </FieldWrapper>
    )
  }

  if (prop.enum) {
    return (
      <FieldWrapper
        label={label}
        required={required}
        description={prop.description}
      >
        <select
          value={String(value ?? ``)}
          onChange={(e) => {
            const selected = e.target.value
            const original = prop.enum!.find((v) => String(v) === selected)
            onChange(original ?? selected)
          }}
          autoFocus={autoFocus}
          style={inputStyle}
        >
          {!required && <option value="">—</option>}
          {prop.enum.map((v) => (
            <option key={String(v)} value={String(v)}>
              {String(v)}
            </option>
          ))}
        </select>
      </FieldWrapper>
    )
  }

  if (prop.type === `boolean`) {
    return (
      <FieldWrapper
        label={label}
        required={required}
        description={prop.description}
      >
        <label
          style={{
            display: `flex`,
            alignItems: `center`,
            gap: 8,
            cursor: `pointer`,
          }}
        >
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            autoFocus={autoFocus}
          />
          <Text size="2">{label}</Text>
        </label>
      </FieldWrapper>
    )
  }

  if (prop.type === `number` || prop.type === `integer`) {
    return (
      <FieldWrapper
        label={label}
        required={required}
        description={prop.description}
      >
        <input
          type="number"
          value={value !== undefined && value !== null ? String(value) : ``}
          autoFocus={autoFocus}
          onChange={(e) => {
            const v = e.target.value
            if (v === ``) {
              onChange(undefined)
            } else {
              onChange(
                prop.type === `integer` ? parseInt(v, 10) : parseFloat(v)
              )
            }
          }}
          step={prop.type === `integer` ? 1 : `any`}
          placeholder={prop.description ?? name}
          style={inputStyle}
        />
      </FieldWrapper>
    )
  }

  // Default: string
  return (
    <FieldWrapper
      label={label}
      required={required}
      description={prop.description}
    >
      <input
        type="text"
        value={String(value ?? ``)}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        placeholder={prop.description ?? name}
        style={inputStyle}
      />
    </FieldWrapper>
  )
}

function FieldWrapper({
  label,
  required,
  description,
  children,
}: {
  label: string
  required: boolean
  description?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <Flex direction="column" gap="1">
      <Text size="2" weight="medium">
        {label}
        {required && (
          <span style={{ color: `var(--red-9)`, marginLeft: 2 }}>*</span>
        )}
      </Text>
      {children}
      {description && (
        <Text size="1" color="gray">
          {description}
        </Text>
      )}
    </Flex>
  )
}

function RawJsonForm({
  onSpawn,
}: {
  onSpawn: (args: Record<string, unknown>) => void
}): React.ReactElement {
  const [raw, setRaw] = useState(`{}`)
  const [parseError, setParseError] = useState<string | null>(null)

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      try {
        const parsed: unknown = JSON.parse(raw)
        if (
          typeof parsed !== `object` ||
          Array.isArray(parsed) ||
          parsed === null
        ) {
          setParseError(`Must be a JSON object`)
          return
        }
        setParseError(null)
        onSpawn(parsed as Record<string, unknown>)
      } catch {
        setParseError(`Invalid JSON`)
      }
    },
    [raw, onSpawn]
  )

  return (
    <form onSubmit={handleSubmit}>
      <Flex direction="column" gap="2">
        <Text size="2" weight="medium">
          Arguments (JSON)
        </Text>
        <textarea
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value)
            setParseError(null)
          }}
          rows={6}
          autoFocus
          style={textareaStyle}
        />
        {parseError && (
          <Text size="1" color="red">
            {parseError}
          </Text>
        )}
      </Flex>
      <Flex gap="3" mt="4" justify="end">
        <Dialog.Close>
          <Button variant="soft" color="gray">
            Cancel
          </Button>
        </Dialog.Close>
        <Button type="submit">Create</Button>
      </Flex>
    </form>
  )
}

const inputStyle: React.CSSProperties = {
  width: `100%`,
  padding: `6px 10px`,
  borderRadius: `var(--radius-2)`,
  border: `1px solid var(--gray-a4)`,
  background: `var(--gray-a2)`,
  fontSize: `var(--font-size-2)`,
  fontFamily: `var(--default-font-family)`,
  color: `var(--gray-12)`,
  outline: `none`,
}

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: `vertical`,
  fontFamily: `monospace`,
  fontSize: `var(--font-size-1)`,
}
