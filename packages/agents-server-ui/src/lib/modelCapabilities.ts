const MODEL_INPUTS_SCHEMA_DEF = `electricModelInputs`

type SchemaObject = Record<string, unknown>

function isRecord(value: unknown): value is SchemaObject {
  return value !== null && typeof value === `object` && !Array.isArray(value)
}

export function isModelProperty(key: string): boolean {
  const normalized = key.toLowerCase()
  return (
    normalized === `model` ||
    normalized === `modelid` ||
    normalized === `model_id`
  )
}

function objectProperties(schema: unknown): Record<string, unknown> | null {
  if (!isRecord(schema) || !isRecord(schema.properties)) return null
  return schema.properties
}

function modelValueFromSchema(
  schema: unknown,
  args: Readonly<Record<string, unknown>>
): string | null {
  const properties = objectProperties(schema)
  if (!properties) return null

  for (const [key, rawProp] of Object.entries(properties)) {
    if (!isModelProperty(key) || !isRecord(rawProp)) continue

    const argValue = args[key]
    if (typeof argValue === `string` && argValue) return argValue

    if (rawProp.default !== undefined && rawProp.default !== null) {
      return String(rawProp.default)
    }

    if (Array.isArray(rawProp.enum) && rawProp.enum.length > 0) {
      return String(rawProp.enum[0])
    }
  }

  return null
}

function normalizeInputs(value: unknown): Array<`text` | `image`> | null {
  if (!Array.isArray(value)) return null
  const inputs = value.filter(
    (item): item is `text` | `image` => item === `text` || item === `image`
  )
  return inputs.length > 0 ? inputs : null
}

function modelInputsFromSchema(
  schema: unknown,
  modelValue: string
): Array<`text` | `image`> | null {
  if (!isRecord(schema) || !isRecord(schema.$defs)) return null
  const modelInputsDef = schema.$defs[MODEL_INPUTS_SCHEMA_DEF]
  if (!isRecord(modelInputsDef) || !isRecord(modelInputsDef.properties)) {
    return null
  }

  const modelSchema = modelInputsDef.properties[modelValue]
  if (!isRecord(modelSchema)) return null

  return normalizeInputs(modelSchema.default)
}

export function schemaModelSupportsImageInput(
  schema: unknown,
  args: Readonly<Record<string, unknown>>
): boolean {
  const modelValue = modelValueFromSchema(schema, args)
  if (!modelValue) return true

  // pi-ai exposes this as model.input ("text"/"image") rather than a
  // generic attachment flag. Registered agent schemas mirror that metadata
  // under $defs so the UI can gate image attachments without provider hacks.
  const inputs = modelInputsFromSchema(schema, modelValue)
  if (!inputs) return true

  return inputs.includes(`image`)
}
