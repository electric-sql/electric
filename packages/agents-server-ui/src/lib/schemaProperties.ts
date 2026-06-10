import { isModelProperty } from './modelCapabilities'

/**
 * Shared, DOM-free helpers for classifying an entity `creation_schema`'s
 * properties. Used by the desktop `SchemaForm` / new-session composer and by
 * the native (React Native) mobile spawn composer, so both platforms derive
 * model / reasoning / speed controls from the same rules.
 */

export interface SchemaProperty {
  type?: string
  enum?: Array<unknown>
  items?: { type?: string }
  default?: unknown
  title?: string
  description?: string
}

export interface ObjectSchema {
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

/** A scalar property the form renders with a single typed input. */
export function isSimpleType(prop: SchemaProperty): boolean {
  if (prop.enum) return true
  return (
    prop.type === `string` ||
    prop.type === `number` ||
    prop.type === `integer` ||
    prop.type === `boolean`
  )
}

export function isStringArrayType(prop: SchemaProperty): boolean {
  return prop.type === `array` && prop.items?.type === `string`
}

/**
 * Parse a display string into a string array. Accepts JSON array syntax
 * (`["a","b"]`) or a comma-separated list (`a, b`).
 */
export function parseStringArray(text: string): Array<string> {
  const trimmed = text.trim()
  if (trimmed === ``) return []
  if (trimmed.startsWith(`[`)) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === `string`)) {
        return parsed
      }
    } catch {
      // Fall through to comma-separated parsing.
    }
  }
  return trimmed
    .split(`,`)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function stringArrayToDisplay(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(`, `)
  if (typeof value === `string`) return value
  return ``
}

export type InlineSchemaProperty = { key: string; prop: SchemaProperty }

/**
 * Properties that render as compact inline controls (pills/toggles) rather
 * than full form fields: enums and booleans.
 */
export function inlineSchemaProperties(
  schema: unknown
): Array<InlineSchemaProperty> {
  if (!isObjectSchema(schema)) return []
  const out: Array<InlineSchemaProperty> = []
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (prop.enum && prop.enum.length > 0) {
      out.push({ key, prop })
    } else if (prop.type === `boolean`) {
      out.push({ key, prop })
    }
  }
  return out
}

function normalizedSchemaKey(key: string): string {
  return key.replace(/[\s_-]/g, ``).toLowerCase()
}

export function isReasoningProperty(key: string): boolean {
  const normalized = normalizedSchemaKey(key)
  return (
    normalized === `reasoningeffort` ||
    normalized === `reasoninglevel` ||
    normalized === `thinkingeffort` ||
    normalized === `thinkinglevel`
  )
}

export function isSpeedProperty(key: string): boolean {
  const normalized = normalizedSchemaKey(key)
  return (
    normalized === `speed` ||
    normalized === `speedlevel` ||
    normalized === `speedmode` ||
    normalized === `servicetier` ||
    normalized === `latencytier`
  )
}

export type ModelSettingsProps = {
  model: InlineSchemaProperty
  reasoning: InlineSchemaProperty
  speed?: InlineSchemaProperty
}

/**
 * Split inline properties into the model-settings bundle (a model + reasoning
 * enum, plus an optional speed enum) and the remaining standalone controls.
 * The bundle only forms when both a model and a reasoning enum are present, so
 * agents that expose just one of them keep rendering it as a standalone pill.
 */
export function groupModelSettings(inlineProps: Array<InlineSchemaProperty>): {
  modelSettings: ModelSettingsProps | null
  standalone: Array<InlineSchemaProperty>
} {
  const model = inlineProps.find(
    ({ key, prop }) => isModelProperty(key) && prop.enum?.length
  )
  const reasoning = inlineProps.find(
    ({ key, prop }) => isReasoningProperty(key) && prop.enum?.length
  )
  if (!model || !reasoning) {
    return { modelSettings: null, standalone: inlineProps }
  }
  const speed = inlineProps.find(
    ({ key, prop }) => isSpeedProperty(key) && prop.enum?.length
  )
  const combinedKeys = new Set([
    model.key,
    reasoning.key,
    ...(speed ? [speed.key] : []),
  ])
  return {
    modelSettings: { model, reasoning, speed },
    standalone: inlineProps.filter(({ key }) => !combinedKeys.has(key)),
  }
}
