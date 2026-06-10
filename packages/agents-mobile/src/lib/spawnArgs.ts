import { isModelProperty } from '@electric-ax/agents-server-ui/src/lib/modelCapabilities'
import {
  inlineSchemaProperties,
  isObjectSchema,
  isSimpleType,
  isStringArrayType,
  parseStringArray,
} from '@electric-ax/agents-server-ui/src/lib/schemaProperties'
import type {
  InlineSchemaProperty,
  SchemaProperty,
} from '@electric-ax/agents-server-ui/src/lib/schemaProperties'
import { getLastPickedModel } from './lastPickedModel'

/**
 * Derives spawn `args` from an entity type's `creation_schema` for the mobile
 * new-session composer. Mirrors the desktop `DefaultAgentComposer`:
 * enum/boolean properties render as inline controls and string/number
 * properties as text fields, so agents with structured creation args can be
 * configured (and started) from mobile too.
 */

/** A text field: string / number / integer property that isn't an enum. */
export function isTextFieldProperty(prop: SchemaProperty): boolean {
  if (prop.enum && prop.enum.length > 0) return false
  return (
    prop.type === `string` || prop.type === `number` || prop.type === `integer`
  )
}

function objectSchemaEntries(
  schema: unknown,
  omitKeys: ReadonlyArray<string> | undefined,
  match: (prop: SchemaProperty) => boolean
): Array<InlineSchemaProperty> {
  if (!isObjectSchema(schema)) return []
  const omit = new Set(omitKeys ?? [])
  const out: Array<InlineSchemaProperty> = []
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (!omit.has(key) && match(prop)) out.push({ key, prop })
  }
  return out
}

/** Ordered text-field (string/number) properties, minus keys handled elsewhere. */
export function textFieldEntries(
  schema: unknown,
  omitKeys?: ReadonlyArray<string>
): Array<InlineSchemaProperty> {
  return objectSchemaEntries(schema, omitKeys, isTextFieldProperty)
}

/** String-array properties, rendered as a comma-separated text field. */
export function arrayFieldEntries(
  schema: unknown,
  omitKeys?: ReadonlyArray<string>
): Array<InlineSchemaProperty> {
  return objectSchemaEntries(schema, omitKeys, isStringArrayType)
}

/** Complex properties (objects / non-string arrays), rendered as a JSON field. */
export function objectFieldEntries(
  schema: unknown,
  omitKeys?: ReadonlyArray<string>
): Array<InlineSchemaProperty> {
  return objectSchemaEntries(
    schema,
    omitKeys,
    (prop) => !isSimpleType(prop) && !isStringArrayType(prop)
  )
}

/** Inline (enum/boolean) properties, minus any keys handled elsewhere. */
export function inlineArgProperties(
  schema: unknown,
  omitKeys?: ReadonlyArray<string>
): Array<InlineSchemaProperty> {
  const omit = new Set(omitKeys ?? [])
  return inlineSchemaProperties(schema).filter(({ key }) => !omit.has(key))
}

/** Whether the schema has any args control to render (after omissions). */
export function hasSpawnArgControls(
  schema: unknown,
  omitKeys?: ReadonlyArray<string>
): boolean {
  return (
    inlineArgProperties(schema, omitKeys).length > 0 ||
    textFieldEntries(schema, omitKeys).length > 0 ||
    arrayFieldEntries(schema, omitKeys).length > 0 ||
    objectFieldEntries(schema, omitKeys).length > 0
  )
}

export function buildInitialSpawnArgs(
  schema: unknown
): Record<string, unknown> {
  const init: Record<string, unknown> = {}
  for (const { key, prop } of inlineSchemaProperties(schema)) {
    if (prop.enum && prop.enum.length > 0 && isModelProperty(key)) {
      const options = prop.enum.map((v) => String(v))
      const lastPicked = getLastPickedModel(options)
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
  // Seed declared defaults for the remaining (text / array / object) fields.
  if (isObjectSchema(schema)) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      if (!(key in init) && prop.default !== undefined) init[key] = prop.default
    }
  }
  return init
}

/** Coerce a text input value to the property's type, dropping empty input. */
export function coerceTextFieldValue(
  prop: SchemaProperty,
  text: string
): unknown {
  if (text === ``) return undefined
  if (prop.type === `number` || prop.type === `integer`) {
    const n = Number(text)
    // Coerce only when the number round-trips to the same text, so partial
    // input like `1.` or `-` stays editable; the server validates the final
    // value.
    return Number.isFinite(n) && String(n) === text ? n : text
  }
  return text
}

/**
 * Prepare the collected values for the spawn payload: drop unset/empty values
 * and convert string-array text fields to arrays (mirrors the desktop
 * `SchemaForm` submit handler). Object fields are already parsed on edit.
 */
export function finalizeSpawnArgs(
  schema: unknown,
  args: Record<string, unknown>
): Record<string, unknown> {
  const properties = isObjectSchema(schema) ? schema.properties : {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === ``) continue
    const prop = properties[key]
    if (prop && isStringArrayType(prop) && typeof value === `string`) {
      const arr = parseStringArray(value)
      if (arr.length > 0) out[key] = arr
      continue
    }
    out[key] = value
  }
  return out
}

/** True when a required property has no usable value yet (gates spawn). */
export function hasMissingRequiredArgs(
  schema: unknown,
  args: Record<string, unknown>,
  omitKeys?: ReadonlyArray<string>
): boolean {
  if (!isObjectSchema(schema)) return false
  const omit = new Set(omitKeys ?? [])
  for (const key of schema.required ?? []) {
    if (omit.has(key)) continue
    const value = args[key]
    if (value === undefined || value === `` || value === null) return true
  }
  return false
}
