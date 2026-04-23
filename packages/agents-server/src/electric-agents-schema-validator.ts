import Ajv from 'ajv'

export class SchemaValidator {
  private ajv: Ajv

  constructor() {
    this.ajv = new Ajv({ allErrors: true })
  }

  /**
   * Validate data against a JSON Schema. Returns null if valid.
   * Returns error details on failure.
   */
  validate(
    schema: Record<string, unknown>,
    data: unknown
  ): {
    code: string
    message: string
    details: Array<{ path: string; message: string }>
  } | null {
    const validate = this.ajv.compile(schema)
    if (validate(data)) return null

    return {
      code: `SCHEMA_VALIDATION_FAILED`,
      message: `Validation failed`,
      details: (validate.errors ?? []).map((err) => ({
        path: err.instancePath || `/`,
        message: err.message ?? `validation error`,
      })),
    }
  }

  /**
   * Check that a JSON Schema only uses allowed keywords.
   * Returns null if valid, error details if disallowed keywords found.
   */
  validateSchemaSubset(schema: Record<string, unknown>): {
    code: string
    message: string
    details: Array<{ path: string; message: string }>
  } | null {
    // Recursively walk the schema and check each key
    const disallowed = this.findDisallowedKeywords(schema, ``)
    if (disallowed.length === 0) return null

    return {
      code: `INVALID_REQUEST`,
      message: `Schema uses disallowed keywords`,
      details: disallowed,
    }
  }

  private findDisallowedKeywords(
    obj: Record<string, unknown>,
    path: string
  ): Array<{ path: string; message: string }> {
    const issues: Array<{ path: string; message: string }> = []

    for (const [key, value] of Object.entries(obj)) {
      if (!ALLOWED_SCHEMA_KEYWORDS.has(key)) {
        issues.push({
          path: path ? `${path}/${key}` : `/${key}`,
          message: `Disallowed keyword: ${key}`,
        })
      }

      if (Array.isArray(value)) {
        if (key === `anyOf` || key === `oneOf` || key === `allOf`) {
          for (const [index, item] of value.entries()) {
            if (isPlainObject(item)) {
              issues.push(
                ...this.findDisallowedKeywords(item, `${path}/${key}/${index}`)
              )
            }
          }
        }
        continue
      }

      if (!isPlainObject(value)) continue

      if (key === `properties` || key === `$defs` || key === `definitions`) {
        for (const [subKey, subValue] of Object.entries(value)) {
          if (isPlainObject(subValue)) {
            issues.push(
              ...this.findDisallowedKeywords(
                subValue,
                `${path}/${key}/${subKey}`
              )
            )
          }
        }
      } else if (key === `items`) {
        issues.push(...this.findDisallowedKeywords(value, `${path}/items`))
      }
    }

    return issues
  }
}

const ALLOWED_SCHEMA_KEYWORDS = new Set([
  `type`,
  `properties`,
  `required`,
  `enum`,
  `const`,
  `minimum`,
  `maximum`,
  `exclusiveMinimum`,
  `exclusiveMaximum`,
  `minLength`,
  `maxLength`,
  `pattern`,
  `items`,
  `minItems`,
  `maxItems`,
  `$ref`,
  `anyOf`,
  `oneOf`,
  `allOf`,
  `not`,
  `format`,
  `title`,
  `description`,
  `default`,
  `additionalProperties`,
  `nullable`,
  `$schema`,
  `$id`,
  `$defs`,
  `definitions`,
])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === `object` && !Array.isArray(value)
}
