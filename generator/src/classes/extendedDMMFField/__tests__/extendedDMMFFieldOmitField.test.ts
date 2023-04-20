import { DMMF } from '@prisma/generator-helper'
import { it, expect, describe } from 'vitest'

import { DEFAULT_GENERATOR_CONFIG, FIELD_BASE } from './setup'
import { ExtendedDMMFFieldOmitField } from '../extendedDMMFFieldOmitField'

const getField = (field?: Partial<DMMF.Field>) =>
  new ExtendedDMMFFieldOmitField(
    { ...FIELD_BASE, ...field },
    DEFAULT_GENERATOR_CONFIG,
    'ModelName'
  )

describe(`ExtendedDMMFFieldOmitField`, () => {
  it(`should load field with docs and custom validator`, async () => {
    const field = getField({
      documentation: 'some text in docs @zod.custom.omit(["model", "input"])',
    })
    const fieldTwo = getField({
      documentation: 'some text in docs @zod.custom.omit([model, input])',
    })
    const fieldThree = getField({
      documentation: "some text in docs @zod.custom.omit(['model', 'input'])",
    })
    expect(field.zodOmitField).toBe('all')
    expect(field.isOmitField()).toBe(true)
    expect(fieldTwo.zodOmitField).toBe('all')
    expect(fieldTwo.isOmitField()).toBe(true)
    expect(fieldThree.zodOmitField).toBe('all')
    expect(fieldThree.isOmitField()).toBe(true)
  })

  it(`should load field with docs and custom validator`, async () => {
    const field = getField({
      documentation: 'some text in docs @zod.custom.omit(["model"])',
    })
    const fieldTwo = getField({
      documentation: 'some text in docs @zod.custom.omit([model])',
    })
    const fieldThree = getField({
      documentation: "some text in docs @zod.custom.omit(['model'])",
    })
    expect(field.zodOmitField).toBe('model')
    expect(field.isOmitField()).toBe(true)
    expect(fieldTwo.zodOmitField).toBe('model')
    expect(fieldTwo.isOmitField()).toBe(true)
    expect(fieldThree.zodOmitField).toBe('model')
    expect(fieldThree.isOmitField()).toBe(true)
  })

  it(`should load field with docs and custom validator`, async () => {
    const field = getField({
      documentation: 'some text in docs @zod.custom.omit(["input"])',
    })
    const fieldTwo = getField({
      documentation: 'some text in docs @zod.custom.omit([input])',
    })
    const fieldThree = getField({
      documentation: "some text in docs @zod.custom.omit(['input'])",
    })
    expect(field.zodOmitField).toBe('input')
    expect(field.isOmitField()).toBe(true)
    expect(fieldTwo.zodOmitField).toBe('input')
    expect(fieldTwo.isOmitField()).toBe(true)
    expect(fieldThree.zodOmitField).toBe('input')
    expect(fieldThree.isOmitField()).toBe(true)
  })

  it(`should load field with docs and custom validator witout omit`, async () => {
    const field = getField({
      documentation: 'some text in docs @zod.custom.use(z.string())',
    })

    expect(field.zodOmitField).toBe('none')
  })

  it(`should throw an error when wrong option is used`, async () => {
    expect(() =>
      getField({
        documentation: 'some text in docs @zod.custom.omit(["model", "wrong"])',
      })
    ).toThrowError(
      "[@zod generator error]: unknown key 'wrong' in '.omit()'. only 'model' and 'input' are allowed. [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })

  it(`should load field with docs and custom validator and test "omitInModel" method`, async () => {
    const field = getField({
      documentation: 'some text in docs @zod.custom.omit(["model", "input"])',
    })
    const fieldTwo = getField({
      documentation: 'some text in docs @zod.custom.omit(["model"])',
    })
    const fieldThree = getField({
      documentation: 'some text in docs @zod.custom.omit(["input"])',
    })
    expect(field.zodOmitField).toBe('all')
    expect(field.omitInModel()).toBe(true)
    expect(fieldTwo.zodOmitField).toBe('model')
    expect(fieldTwo.omitInModel()).toBe(true)
    expect(fieldThree.zodOmitField).toBe('input')
    expect(fieldThree.omitInModel()).toBe(false)
  })

  it(`should load field with docs and custom validator and test "omitInInputTypes" method`, async () => {
    const field = getField({
      documentation: 'some text in docs @zod.custom.omit(["model", "input"])',
    })
    const fieldTwo = getField({
      documentation: 'some text in docs @zod.custom.omit(["model"])',
    })
    const fieldThree = getField({
      documentation: 'some text in docs @zod.custom.omit(["input"])',
    })
    expect(field.zodOmitField).toBe('all')
    expect(field.omitInInputTypes('UserCreateManyInput')).toBe(true)
    expect(fieldTwo.zodOmitField).toBe('model')
    expect(fieldTwo.omitInInputTypes('UserCreateManyInput')).toBe(false)
    expect(fieldThree.zodOmitField).toBe('input')
    expect(fieldThree.omitInInputTypes('UserCreateManyInput')).toBe(true)
  })
})
