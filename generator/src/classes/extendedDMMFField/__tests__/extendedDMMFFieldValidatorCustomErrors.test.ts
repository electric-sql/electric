import { DMMF } from '@prisma/generator-helper'
import { it, expect, describe } from 'vitest'

import { DEFAULT_GENERATOR_CONFIG, FIELD_BASE } from './setup'
import { ExtendedDMMFFieldValidatorCustomErrors } from '../extendedDMMFFieldValidatorCustomErrors'

const getField = (field?: Partial<DMMF.Field>) =>
  new ExtendedDMMFFieldValidatorCustomErrors(
    { ...FIELD_BASE, ...field },
    DEFAULT_GENERATOR_CONFIG,
    'ModelName'
  )

describe(`ExtendedDMMFFieldValidatorCustomErrors`, () => {
  it(`should load a class without docs`, async () => {
    const field = getField()
    expect(field?.['_validatorCustomError']).toBeUndefined()
    expect(field?.zodCustomErrors).toBeUndefined()
  })

  it(`should load a class with valid custom error messages`, async () => {
    const field = getField({
      documentation:
        '@zod.string({ required_error: "error", invalid_type_error: "error" , description: "error"})',
    })
    expect(field?.['_validatorCustomError']).toBe(
      '({ required_error: "error", invalid_type_error: "error" , description: "error"})'
    )
    expect(field?.zodCustomErrors).toBe(
      '{ required_error: "error", invalid_type_error: "error" , description: "error"}'
    )
  })

  it(`should load a class with docs and invalid validator string`, async () => {
    expect(() =>
      getField({
        documentation:
          '@zod.string({ required_error: "error", invalid_type_errrror: "error"})',
      })
    ).toThrowError(
      "[@zod generator error]: Custom error key 'invalid_type_errrror' is not valid. Please check for typos! [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })
})
