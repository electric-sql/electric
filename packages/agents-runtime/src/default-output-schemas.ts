/**
 * Default output schemas for the standard Electric Agents entity event vocabulary.
 *
 * Registered on built-in agent types so the write endpoint validates adapter
 * events against the same schema source that backs runtime collection helpers.
 */

import { zodToJsonSchema } from 'zod-to-json-schema'
import { BUILT_IN_EVENT_SCHEMAS } from './entity-schema'

function toOutputSchema(schema: unknown): Record<string, unknown> {
  const { $schema: _schema, ...rest } = zodToJsonSchema(schema as any, {
    target: `jsonSchema7`,
  })
  return rest
}

export const DEFAULT_OUTPUT_SCHEMAS: Record<
  string,
  Record<string, unknown>
> = Object.fromEntries(
  Object.entries(BUILT_IN_EVENT_SCHEMAS).map(([eventType, schema]) => [
    eventType,
    toOutputSchema(schema),
  ])
)
