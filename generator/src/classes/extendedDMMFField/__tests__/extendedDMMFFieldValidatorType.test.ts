import { DMMF } from '@prisma/generator-helper'
import { it, expect, describe } from 'vitest'

import { DEFAULT_GENERATOR_CONFIG, FIELD_BASE } from './setup'
import { ExtendedDMMFFieldValidatorType } from '../extendedDMMFFieldValidatorType'

const getField = (field?: Partial<DMMF.Field>) =>
  new ExtendedDMMFFieldValidatorType(
    { ...FIELD_BASE, ...field },
    DEFAULT_GENERATOR_CONFIG,
    'ModelName'
  )

describe(`ExtendedDMMFFieldValidatorType`, () => {
  it(`should load a class without docs`, async () => {
    const field = getField()
    expect(field?.['_validatorMatch']).toBeUndefined()
    expect(field?.['_validatorType']).toBeUndefined()
  })

  it(`should load a class with docs`, async () => {
    const field = getField({ documentation: 'some text in docs' })
    expect(field?.['_validatorMatch']).toBeUndefined()
    expect(field?.['_validatorType']).toBeUndefined()
  })

  it(`should load a class with docs and valid validator string`, async () => {
    const field = getField({
      documentation: 'some text in docs @zod.string.max(4)',
    })
    expect(field?.['_validatorMatch']).toBeDefined()
    expect(field?.['_validatorType']).toBe('string')
  })

  it(`should load a class with docs and valid enum validator string`, async () => {
    const field = getField({
      type: 'MyEnum',
      kind: 'enum',
      isList: true,
      documentation: 'some text in docs @zod.enum.array(.length(2))',
    })
    expect(field?.['_validatorMatch']).toBeDefined()
    expect(field?.['_validatorType']).toBe('enum')
  })

  it(`should load a class with docs and valid object validator string`, async () => {
    const field = getField({
      type: 'MyType',
      kind: 'object',
      isList: true,
      documentation: 'some text in docs @zod.object.array(.length(2))',
    })
    expect(field?.['_validatorMatch']).toBeDefined()
    expect(field?.['_validatorType']).toBe('object')
  })

  it(`should load a class with docs and invalid validator string`, async () => {
    expect(() =>
      getField({
        documentation: 'some text in docs @zod.numer.max(4)',
      })
    ).toThrowError(
      "[@zod generator error]: 'numer' is not a valid validator type. [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })
})
