import { DMMF } from '@prisma/generator-helper'
import { it, expect, describe } from 'vitest'

import { DEFAULT_GENERATOR_CONFIG, FIELD_BASE } from './setup'
import { ExtendedDMMFFieldArrayValidatorString } from '../extendedDMMFFieldArrayValidatorString'

const getField = (field?: Partial<DMMF.Field>) =>
  new ExtendedDMMFFieldArrayValidatorString(
    { ...FIELD_BASE, ...field },
    DEFAULT_GENERATOR_CONFIG,
    'ModelName'
  )
describe(`ExtendedDMMFFieldArrayValidatorString`, () => {
  it(`should load field with docs and array validator on string list`, async () => {
    const field = getField({
      documentation: 'some text in docs @zod.string.min(4).array(.length(2))',
      isList: true,
    })
    expect(field.zodArrayValidatorString).toBe('.length(2)')
    expect(field.zodValidatorString).toBe('.min(4)')
  })

  it(`should load field with docs and array validator on Int list`, async () => {
    const field = getField({
      type: 'Int',
      isList: true,
      documentation: 'some text in docs @zod.number.lt(4).array(.length(2))',
    })
    expect(field.zodArrayValidatorString).toBe('.length(2)')
    expect(field.zodValidatorString).toBe('.lt(4)')
  })

  it(`should load field with docs and array validator on custom int list`, async () => {
    const field = getField({
      type: 'Int',
      isList: true,
      documentation:
        'some text in docs @zod.custom.use(z.string.min(4)).array(.length(2))',
    })

    expect(field.zodArrayValidatorString).toBe('.length(2)')
    expect(field.zodCustomValidatorString).toBe('z.string.min(4)')
  })

  it(`should load field with docs and array validator on enum list`, async () => {
    const field = getField({
      type: 'MyEnum',
      kind: 'enum',
      isList: true,
      documentation: 'some text in docs @zod.enum.array(.length(2))',
    })

    expect(field.zodArrayValidatorString).toBe('.length(2)')
  })

  it(`should load field with docs and array validator on object list`, async () => {
    const field = getField({
      type: 'MyType',
      kind: 'object',
      isList: true,
      documentation: 'some text in docs @zod.object.array(.length(2))',
    })

    expect(field.zodArrayValidatorString).toBe('.length(2)')
  })

  it(`should NOT load field with docs and array validator on a single string`, async () => {
    expect(() =>
      getField({
        documentation: 'some text in docs @zod.string.min(4).array(.length(2))',
        isList: false,
      })
    ).toThrowError(
      "[@zod generator error]: '.array' validator is only allowed on lists. [Error Location]: Model: 'ModelName', Field: 'test'"
    )
  })

  it(`should NOT load field with docs and array validator on a single string if no pattern is present`, async () => {
    const field = getField({
      isList: false,
      documentation: 'some text in docs @zod.string.min(3)',
    })

    expect(field.zodArrayValidatorString).toBeUndefined()
  })

  it(`should load field with docs and array validator list on string`, async () => {
    const field = getField({
      documentation:
        'some text in docs @zod.string.min(4).array(.length(2).min(3).max(4).nonempty())',
      isList: true,
    })
    expect(field.zodArrayValidatorString).toBe(
      '.length(2).min(3).max(4).nonempty()'
    )
  })

  it(`should load field with docs and array validator list on string with message`, async () => {
    const field = getField({
      documentation:
        'some text in docs @zod.string.min(4).array(.length(2, { message: "my message" }).min(3, { message: "my message" }).max(4, { message: "my message" }).nonempty({ message: "my message" }))',
      isList: true,
    })
    expect(field.zodArrayValidatorString).toBe(
      '.length(2, { message: "my message" }).min(3, { message: "my message" }).max(4, { message: "my message" }).nonempty({ message: "my message" })'
    )
  })

  it(`should NOT load field with docs and array validator on a single string with wrong error message key`, async () => {
    expect(() =>
      getField({
        documentation:
          'some text in docs @zod.string.min(4).array(.length(2, { mussage: "my message" })',
        isList: true,
      })
    ).toThrowError(
      "[@zod generator error]: Could not match validator 'length' with validatorPattern '.length(2, { mussage: \"my message\" }'. Please check for typos! [Error Location]: Model: 'ModelName', Field: 'test'"
    )
  })

  it(`should NOT load field with docs and array validator on a single string wiht wrong validator`, async () => {
    expect(() =>
      getField({
        documentation:
          'some text in docs @zod.string.min(4).array(.lt(2, { mussage: "my message" })',
        isList: true,
      })
    ).toThrowError(
      "[@zod generator error]: Validator 'lt' is not valid for type 'String', for specified '@zod.[key] or for 'z.array.[key]'. [Error Location]: Model: 'ModelName', Field: 'test'"
    )
  })

  it(`should load field with docs and array validator containing a string`, async () => {
    const field = getField({
      documentation:
        'some text in docs @zod.string.min(4).array(.length(2).min(myfunction.some).max(myfunction.some).nonempty())',
      isList: true,
    })
    expect(field.zodArrayValidatorString).toBe(
      '.length(2).min(myfunction.some).max(myfunction.some).nonempty()'
    )
  })

  it(`should load field with docs and array validator containing a string on an enum`, async () => {
    const field = getField({
      type: 'MyEnum',
      kind: 'enum',
      documentation:
        'some text in docs @zod.enum.array(.length(myfunction.some, { message: "error" }).min(1).max(myfunction.some).nonempty({ message: "error" }))',
      isList: true,
    })
    expect(field.zodArrayValidatorString).toBe(
      '.length(myfunction.some, { message: "error" }).min(1).max(myfunction.some).nonempty({ message: "error" })'
    )
  })
})
