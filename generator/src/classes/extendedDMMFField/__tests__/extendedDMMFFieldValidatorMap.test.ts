import { DMMF } from '@prisma/generator-helper'
import { it, expect, describe } from 'vitest'

import { DEFAULT_GENERATOR_CONFIG, FIELD_BASE } from './setup'
import { ExtendedDMMFFieldValidatorMap } from '../extendedDMMFFieldValidatorMap'

const getField = (field?: Partial<DMMF.Field>) =>
  new ExtendedDMMFFieldValidatorMap(
    { ...FIELD_BASE, ...field },
    DEFAULT_GENERATOR_CONFIG,
    'ModelName'
  )

/////////////////////////////////////////////
// TEST VALIDATOR MAP
/////////////////////////////////////////////

describe(`ExtendedDMMFFieldValidatorMap test _validatorMap`, () => {
  const field = getField()

  // LOAD INSTANCE
  // ----------------------------------------------

  it(`should load an instance`, async () => {
    expect(field).toBeDefined()
    expect(field?.['_validatorMatch']).toBeUndefined()
    expect(field?.['_validatorType']).toBeUndefined()
    expect(field?.['_validatorCustomError']).toBeUndefined()
    expect(field?.['_validatorPattern']).toBeUndefined()
    expect(field?.zodCustomErrors).toBeUndefined()
  })

  // STRING
  // ----------------------------------------------

  it(`should pass valid string data to validator map`, async () => {
    const map = field?.['_validatorMap']['string']
    expect(
      map({
        key: 'min',
        pattern: '.min(2)',
      })
    ).toBe(true)
    expect(
      map({
        key: 'max',
        pattern: '.max(2)',
      })
    ).toBe(true)
    expect(
      map({
        key: 'length',
        pattern: '.length(2)',
      })
    ).toBe(true)
    expect(
      map({
        key: 'email',
        pattern: '.email()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'url',
        pattern: '.url()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'emoji',
        pattern: '.emoji()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'uuid',
        pattern: '.uuid()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'cuid',
        pattern: '.cuid()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'cuid2',
        pattern: '.cuid2()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'ulid',
        pattern: '.ulid()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'regex',
        pattern: '.regex(/^\\d+\\s*\\d+$/)',
      })
    ).toBe(true)
    expect(
      map({
        key: 'includes',
        pattern: '.includes("some")',
      })
    ).toBe(true)
    expect(
      map({
        key: 'startsWith',
        pattern: '.startsWith("some")',
      })
    ).toBe(true)
    expect(
      map({
        key: 'startsWith',
        pattern: '.startsWith("some")',
      })
    ).toBe(true)
    expect(
      map({
        key: 'datetime',
        pattern: '.datetime()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'ip',
        pattern: '.ip()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'trim',
        pattern: '.trim()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'toLowerCase',
        pattern: '.toLowerCase()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'toUpperCase',
        pattern: '.toUpperCase()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'noDefault',
        pattern: '.noDefault()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'array',
        pattern: '.array(.length(2))',
      })
    ).toBe(true)
  })

  it(`should pass valid string with message data to validator map`, async () => {
    const map = field?.['_validatorMap']['string']
    expect(
      map({
        key: 'min',
        pattern: '.min(2, { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'max',
        pattern: '.max(2, { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'length',
        pattern: '.length(2, { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'email',
        pattern: '.email({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'url',
        pattern: '.url({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'emoji',
        pattern: '.emoji({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'uuid',
        pattern: '.uuid({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'cuid',
        pattern: '.cuid({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'cuid2',
        pattern: '.cuid2({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'ulid',
        pattern: '.ulid({ message: "someMessage" })',
      })
    ).toBe(true)
    // expect(
    //   map({
    //     key: 'regex',
    //     pattern: '.regex(/^\\d+\\s*\\d+$/)',
    //   }),
    // ).toBe(true);
    expect(
      map({
        key: 'includes',
        pattern: '.includes("some", { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'startsWith',
        pattern: '.startsWith("some", { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'startsWith',
        pattern: '.startsWith("some", { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'datetime',
        pattern: '.datetime({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'trim',
        pattern: '.trim({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'toLowerCase',
        pattern: '.toLowerCase({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'toUpperCase',
        pattern: '.toUpperCase({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(map({ key: 'noDefault', pattern: '.noDefault()' })).toBe(true)
    expect(map({ key: 'array', pattern: '.array(.length(2))' })).toBe(true)
  })

  it(`should pass ivalid data to to validator map`, async () => {
    const map = field?.['_validatorMap']['string']

    expect(() =>
      map({
        key: 'array',
        pattern: '.length(2)',
      })
    ).toThrowError(
      "[@zod generator error]: Could not match validator 'array' with validatorPattern '.length(2)'. Please check for typos! [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })

  it(`should pass ivalid key to to validator map`, async () => {
    const map = field?.['_validatorMap']['string']

    expect(() =>
      map({
        key: 'wrong',
        pattern: '.length(2)',
      })
    ).toThrowError(
      "[@zod generator error]: Validator 'wrong' is not valid for type 'String', for specified '@zod.[key] or for 'z.array.[key]'. [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })

  // NUMBER
  // ----------------------------------------------

  it(`should pass valid number data to validator map`, async () => {
    const map = field?.['_validatorMap']['number']
    expect(
      map({
        key: 'gt',
        pattern: '.gt(2)',
      })
    ).toBe(true)
    expect(
      map({
        key: 'gte',
        pattern: '.gte(2)',
      })
    ).toBe(true)
    expect(
      map({
        key: 'lt',
        pattern: '.lt(2)',
      })
    ).toBe(true)
    expect(
      map({
        key: 'lte',
        pattern: '.lte(2)',
      })
    ).toBe(true)
    expect(
      map({
        key: 'multipleOf',
        pattern: '.multipleOf(2)',
      })
    ).toBe(true)
    expect(
      map({
        key: 'int',
        pattern: '.int()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'positive',
        pattern: '.positive()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'nonpositive',
        pattern: '.nonpositive()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'negative',
        pattern: '.negative()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'nonnegative',
        pattern: '.nonnegative()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'finite',
        pattern: '.finite()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'noDefault',
        pattern: '.noDefault()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'array',
        pattern: '.array(.length(2))',
      })
    ).toBe(true)
  })

  it(`should pass valid number with message data to validator map`, async () => {
    const map = field?.['_validatorMap']['number']
    expect(
      map({
        key: 'gt',
        pattern: '.gt(2, { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'gte',
        pattern: '.gte(2, { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'lt',
        pattern: '.lt(2, { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'lte',
        pattern: '.lte(2, { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'multipleOf',
        pattern: '.multipleOf(2, { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'int',
        pattern: '.int({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'positive',
        pattern: '.positive({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'nonpositive',
        pattern: '.nonpositive({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'negative',
        pattern: '.negative({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'nonnegative',
        pattern: '.nonnegative({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'finite',
        pattern: '.finite({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'noDefault',
        pattern: '.noDefault({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'array',
        pattern: '.array(.length(2))',
      })
    ).toBe(true)
  })

  it(`should pass ivalid data to to validator map`, async () => {
    const map = field?.['_validatorMap']['number']

    expect(() =>
      map({
        key: 'array',
        pattern: '.length(2)',
      })
    ).toThrowError(
      "[@zod generator error]: Could not match validator 'array' with validatorPattern '.length(2)'. Please check for typos! [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })

  it(`should pass ivalid key to to validator map`, async () => {
    const map = field?.['_validatorMap']['number']

    expect(() =>
      map({
        key: 'wrong',
        pattern: '.length(2)',
      })
    ).toThrowError(
      "[@zod generator error]: Validator 'wrong' is not valid for type 'String', for specified '@zod.[key] or for 'z.array.[key]'. [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })

  // DATE
  // ----------------------------------------------

  it(`should pass valid date data to validator map`, async () => {
    const map = field?.['_validatorMap']['date']
    expect(
      map({
        key: 'min',
        pattern: '.min(new Date(01-01-2022))',
      })
    ).toBe(true)
    expect(
      map({
        key: 'max',
        pattern: '.max(new Date(Date.now()))',
      })
    ).toBe(true)
    expect(
      map({
        key: 'array',
        pattern: '.array(.length(2))',
      })
    ).toBe(true)
  })

  it(`should pass valid date with message data to validator map`, async () => {
    const map = field?.['_validatorMap']['date']
    expect(
      map({
        key: 'min',
        pattern: '.min(new Date(01-01-2022), { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'max',
        pattern: '.max(new Date(Date.now(), { message: "someMessage" }))',
      })
    ).toBe(true)
    expect(
      map({
        key: 'array',
        pattern: '.array(.length(2))',
      })
    ).toBe(true)
  })

  it(`should pass ivalid data to to validator map`, async () => {
    const map = field?.['_validatorMap']['date']

    expect(() =>
      map({
        key: 'array',
        pattern: '.length(2)',
      })
    ).toThrowError(
      "[@zod generator error]: Could not match validator 'array' with validatorPattern '.length(2)'. Please check for typos! [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })

  it(`should pass ivalid key to to validator map`, async () => {
    const map = field?.['_validatorMap']['date']

    expect(() =>
      map({
        key: 'wrong',
        pattern: '.length(2)',
      })
    ).toThrowError(
      "[@zod generator error]: Validator 'wrong' is not valid for type 'String', for specified '@zod.[key] or for 'z.array.[key]'. [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })

  // BIGINT
  // ----------------------------------------------

  it(`should pass valid bigint data to validator map`, async () => {
    const map = field?.['_validatorMap']['bigint']
    expect(
      map({
        key: 'gt',
        pattern: '.gt(2n)',
      })
    ).toBe(true)
    expect(
      map({
        key: 'gte',
        pattern: '.gte(2n)',
      })
    ).toBe(true)
    expect(
      map({
        key: 'lt',
        pattern: '.lt(2n)',
      })
    ).toBe(true)
    expect(
      map({
        key: 'lte',
        pattern: '.lte(2n)',
      })
    ).toBe(true)
    expect(
      map({
        key: 'multipleOf',
        pattern: '.multipleOf(2n)',
      })
    ).toBe(true)
    expect(
      map({
        key: 'positive',
        pattern: '.positive()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'nonpositive',
        pattern: '.nonpositive()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'negative',
        pattern: '.negative()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'nonnegative',
        pattern: '.nonnegative()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'array',
        pattern: '.array(.length(2))',
      })
    ).toBe(true)
  })

  it(`should pass ivalid data to to validator map`, async () => {
    const map = field?.['_validatorMap']['bigint']
    expect(
      map({
        key: 'gt',
        pattern: '.gt(2n, { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'gte',
        pattern: '.gte(2n, { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'lt',
        pattern: '.lt(2n, { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'lte',
        pattern: '.lte(2n, { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'multipleOf',
        pattern: '.multipleOf(2n, { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'positive',
        pattern: '.positive({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'nonpositive',
        pattern: '.nonpositive({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'negative',
        pattern: '.negative({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'nonnegative',
        pattern: '.nonnegative({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(() =>
      map({
        key: 'array',
        pattern: '.length(2)',
      })
    ).toThrowError(
      "[@zod generator error]: Could not match validator 'array' with validatorPattern '.length(2)'. Please check for typos! [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })

  it(`should pass ivalid key to to validator map`, async () => {
    const map = field?.['_validatorMap']['bigint']

    expect(() =>
      map({
        key: 'wrong',
        pattern: '.length(2)',
      })
    ).toThrowError(
      "[@zod generator error]: Validator 'wrong' is not valid for type 'String', for specified '@zod.[key] or for 'z.array.[key]'. [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })

  // CUSTOM
  // ----------------------------------------------

  it(`should pass valid custom data to validator map`, async () => {
    const map = field?.['_validatorMap']['custom']

    expect(
      map({
        key: 'use',
        pattern: '.use(some content)',
      })
    ).toBe(true)
    expect(
      map({
        key: 'omit',
        pattern: '.omit(["model", "field"])',
      })
    ).toBe(true)
    expect(
      map({
        key: 'array',
        pattern: '.array(.length(2))',
      })
    ).toBe(true)
  })

  it(`should pass ivalid data to to validator map`, async () => {
    const map = field?.['_validatorMap']['custom']

    expect(() =>
      map({
        key: 'array',
        pattern: '.length(2)',
      })
    ).toThrowError(
      "[@zod generator error]: Could not match validator 'array' with validatorPattern '.length(2)'. Please check for typos! [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })

  it(`should pass ivalid key to to validator map`, async () => {
    const map = field?.['_validatorMap']['custom']

    expect(() =>
      map({
        key: 'wrong',
        pattern: '.length(2)',
      })
    ).toThrowError(
      "[@zod generator error]: Validator 'wrong' is not valid for type 'String', for specified '@zod.[key] or for 'z.array.[key]'. [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })

  // ENUM
  // ----------------------------------------------

  it(`should pass valid custom data to validator map`, async () => {
    const map = field?.['_validatorMap']['enum']

    expect(
      map({
        key: 'array',
        pattern: '.array(.length(2))',
      })
    ).toBe(true)
  })

  it(`should pass ivalid data to to validator map`, async () => {
    const map = field?.['_validatorMap']['enum']

    expect(() =>
      map({
        key: 'array',
        pattern: '.length(2)',
      })
    ).toThrowError(
      "[@zod generator error]: Could not match validator 'array' with validatorPattern '.length(2)'. Please check for typos! [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })

  it(`should pass ivalid key to to validator map`, async () => {
    const map = field?.['_validatorMap']['enum']

    expect(() =>
      map({
        key: 'wrong',
        pattern: '.length(2)',
      })
    ).toThrowError(
      "[@zod generator error]: Validator 'wrong' is not valid for type 'String', for specified '@zod.[key] or for 'z.array.[key]'. [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })

  // OBJECT
  // ----------------------------------------------

  it(`should pass valid custom data to validator map`, async () => {
    const map = field?.['_validatorMap']['object']

    expect(
      map({
        key: 'array',
        pattern: '.array(.length(2))',
      })
    ).toBe(true)
  })

  it(`should pass ivalid data to to validator map`, async () => {
    const map = field?.['_validatorMap']['object']

    expect(() =>
      map({
        key: 'array',
        pattern: '.length(2)',
      })
    ).toThrowError(
      "[@zod generator error]: Could not match validator 'array' with validatorPattern '.length(2)'. Please check for typos! [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })

  it(`should pass ivalid key to to validator map`, async () => {
    const map = field?.['_validatorMap']['object']

    expect(() =>
      map({
        key: 'wrong',
        pattern: '.length(2)',
      })
    ).toThrowError(
      "[@zod generator error]: Validator 'wrong' is not valid for type 'String', for specified '@zod.[key] or for 'z.array.[key]'. [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })
})

/////////////////////////////////////////////////
// TEST VALIDATE PATTERN IN MAP
/////////////////////////////////////////////////

describe(`tests ExtendedDMMFFieldValidatorMap method _validatePatternInMap`, () => {
  it(`should pass valid data for string`, async () => {
    const field = getField({
      type: 'String',
      documentation: '@zod.string.array(.length(2))',
    })

    expect(
      field?.['_validatePatternInMap']({
        key: 'array',
        pattern: '.array(.length(2))',
      })
    ).toBe(true)
  })

  it(`should pass invalid data for string`, async () => {
    const field = getField({
      type: 'String',
      documentation: '@zod.string.array(.length(2))',
    })

    expect(() =>
      field?.['_validatePatternInMap']({
        key: 'use',
        pattern: '.use(.length(2))',
      })
    ).toThrowError(
      "[@zod generator error]: Validator 'use' is not valid for type 'String', for specified '@zod.[key] or for 'z.array.[key]'. [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })
})

/////////////////////////////////////////////////
// TEST GET VALIDATOR KEY FROM PATTERN
/////////////////////////////////////////////////

describe(`tests ExtendedDMMFFieldValidatorMap method _getValidatorKeyFromPattern`, () => {
  it(`should pass valid data for string`, async () => {
    const field = getField()
    expect(field?.['_getValidatorKeyFromPattern']('.array(.length(2))')).toBe(
      'array'
    )
  })

  it(`should pass invalid data for string`, async () => {
    const field = getField()

    expect(() =>
      field?.['_getValidatorKeyFromPattern']('wrong(length(2))')
    ).toThrowError(
      "[@zod generator error]: no matching validator key found in 'wrong(length(2))'. [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })
})

/////////////////////////////////////////////////
// TEST VALIDATOR IS VALID
/////////////////////////////////////////////////

describe(`tests ExtendedDMMFFieldValidatorMap method _validatorIsValid`, () => {
  it(`should pass valid data for string`, async () => {
    const field = getField({
      documentation: '@zod.string.min(2).max(4)',
    })
    expect(field?.['_validatorIsValid']()).toBe(true)
  })

  it(`should pass invalid data for string`, async () => {
    const field = getField({
      documentation: '@zod.string.min(2).max(4).lt(3)',
    })

    expect(() => field?.['_validatorIsValid']()).toThrowError(
      "[@zod generator error]: Validator 'lt' is not valid for type 'String', for specified '@zod.[key] or for 'z.array.[key]'. [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })
})
