import Ajv from 'ajv'
import type { TSchema as TypeBoxSchema } from '@sinclair/typebox'
import type { ValidateFunction } from 'ajv'

const jsonBodyAjv = new Ajv({ allErrors: true })
const schemaValidators = new WeakMap<TypeBoxSchema, ValidateFunction>()

export function schemaValidator(schema: TypeBoxSchema): ValidateFunction {
  let validate = schemaValidators.get(schema)
  if (!validate) {
    validate = jsonBodyAjv.compile(schema)
    schemaValidators.set(schema, validate)
  }
  return validate
}
