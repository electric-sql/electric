import { Type } from '@sinclair/typebox'
import { schemaValidator } from './schema-validation.js'
import type { DispatchPolicy } from './electric-agents-types.js'

const nonEmptyStringSchema = Type.String({ minLength: 1 })

const webhookDispatchTargetSchema = Type.Object(
  {
    type: Type.Literal(`webhook`),
    url: nonEmptyStringSchema,
    subscription_id: Type.Optional(nonEmptyStringSchema),
  },
  { additionalProperties: false }
)

const runnerDispatchTargetSchema = Type.Object(
  {
    type: Type.Literal(`runner`),
    runnerId: nonEmptyStringSchema,
    subscription_id: Type.Optional(nonEmptyStringSchema),
  },
  { additionalProperties: false }
)

export const dispatchPolicySchema = Type.Object(
  {
    targets: Type.Tuple([
      Type.Union([webhookDispatchTargetSchema, runnerDispatchTargetSchema]),
    ]),
  },
  { additionalProperties: false }
)

export function parseDispatchPolicy(
  value: unknown,
  label = `dispatch_policy`
): DispatchPolicy {
  const validate = schemaValidator(dispatchPolicySchema)
  if (validate(value)) return value as DispatchPolicy

  const details = (validate.errors ?? [])
    .map((error) => {
      const path = error.instancePath || `/`
      return `${path} ${error.message ?? `failed validation`}`
    })
    .join(`; `)
  throw new Error(
    details
      ? `${label} does not match dispatch policy schema: ${details}`
      : `${label} does not match dispatch policy schema`
  )
}
