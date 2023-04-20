import { it, expect, describe } from 'vitest'

import {
  STRING_VALIDATOR_MESSAGE_REGEX,
  STRING_VALIDATOR_NUMBER_AND_MESSAGE_REGEX,
  STRING_VALIDATOR_REGEX,
  STRING_VALIDATOR_STRING_AND_MESSAGE_REGEX,
  VALIDATOR_KEY_REGEX,
  VALIDATOR_TYPE_REGEX,
} from '../regex'

///////////////////////////////////////////
// VALIDATE WHOLE STRING
///////////////////////////////////////////

describe('test VALIDATOR_TYPE_REGEX', () => {
  it('should match "VALIDATOR_TYPE_REGEX" with customErrors', () => {
    const TYPE = 'string'
    const CUSTOM_ERROR = "({ error: 'someError' })"
    const VALIDATOR =
      ".min(3, { message: 'some string' }).max(10).email({ message: 'some string.' })"
    const STRING = `@zod.${TYPE}${CUSTOM_ERROR}${VALIDATOR}`

    const validator = STRING.match(VALIDATOR_TYPE_REGEX)

    const validatorType = validator?.groups?.['type']
    const validatorCustomErrors = validator?.groups?.['customErrors']
    const validatorPattern = validator?.groups?.['validatorPattern']

    expect(validatorType).toBe(TYPE)
    expect(validatorCustomErrors).toBe(CUSTOM_ERROR)
    expect(validatorPattern).toBe(VALIDATOR)
  })

  it('should match "VALIDATOR_TYPE_REGEX"', () => {
    const TYPE = 'string'
    const VALIDATOR =
      ".min(3, { message: 'some string' }).max(10).email({ message: 'some string' })"
    const STRING = `@zod.${TYPE}${VALIDATOR}`

    const validator = STRING.match(VALIDATOR_TYPE_REGEX)

    const validatorType = validator?.groups?.['type']
    const validatorPattern = validator?.groups?.['validatorPattern']

    expect(validatorType).toBe(TYPE)
    expect(validatorPattern).toBe(VALIDATOR)
  })
})

/////////////////////////////////////////////
// VALIDATOR KEY
/////////////////////////////////////////////

describe('test SPLIT_VALIDATOR_PATTERN_REGEX', () => {
  it('should split validatorPatterns via "SPLIT_VALIDATOR_PATTERN_REGEX"', () => {
    const STRING = ".min(3, { message: 'some string' })"
    const validator = STRING.match(VALIDATOR_KEY_REGEX)
    expect(validator?.groups?.['validatorKey']).toBe('min')
  })
  it('should split validatorPatterns via "SPLIT_VALIDATOR_PATTERN_REGEX"', () => {
    const STRING = ".startsWith('asdfasdf', { message: 'some string' })"
    const validator = STRING.match(VALIDATOR_KEY_REGEX)
    expect(validator?.groups?.['validatorKey']).toBe('startsWith')
  })
})

/////////////////////////////////////////////
// MATCH KEYS
/////////////////////////////////////////////

describe('match keys "min, max, length, email, url, uuid, cuid, trim, datetime, startsWith, endsWith, regex" in all string validator regex', () => {
  it('should match all validators of STRING_VALIDATOR_NUMBER_AND_MESSAGE_REGEX ', () => {
    expect('.min(123)').toMatch(STRING_VALIDATOR_NUMBER_AND_MESSAGE_REGEX)
    expect('.max(123)').toMatch(STRING_VALIDATOR_NUMBER_AND_MESSAGE_REGEX)
    expect('.length(123)').toMatch(STRING_VALIDATOR_NUMBER_AND_MESSAGE_REGEX)
  })

  it('should match all validators of STRING_VALIDATOR_MESSAGE_REGEX', () => {
    expect('.email()').toMatch(STRING_VALIDATOR_MESSAGE_REGEX)
    expect('.url()').toMatch(STRING_VALIDATOR_MESSAGE_REGEX)
    expect('.uuid()').toMatch(STRING_VALIDATOR_MESSAGE_REGEX)
    expect('.cuid()').toMatch(STRING_VALIDATOR_MESSAGE_REGEX)
    expect('.trim()').toMatch(STRING_VALIDATOR_MESSAGE_REGEX)
    expect('.datetime()').toMatch(STRING_VALIDATOR_MESSAGE_REGEX)
  })

  it('should match all validators of STRING_VALIDATOR_STRING_MESSAGE_REGEX', () => {
    expect('.startsWith("asdfa")').toMatch(
      STRING_VALIDATOR_STRING_AND_MESSAGE_REGEX
    )
    expect('.endsWith("asdfa")').toMatch(
      STRING_VALIDATOR_STRING_AND_MESSAGE_REGEX
    )
  })

  it('should match all validators of STRING_VALIDATOR_REGEX', () => {
    expect('.regex(/asdfa/)').toMatch(STRING_VALIDATOR_REGEX)
  })
})

describe("don't match keys in all string validator regex", () => {
  it('should match STRING_VALIDATOR_NUMBER_AND_MESSAGE_REGEX in different versions', () => {
    expect('.min(123, { message: "max" })').toMatch(
      STRING_VALIDATOR_NUMBER_AND_MESSAGE_REGEX
    )
    expect('.min(123,{message: "max"})').toMatch(
      STRING_VALIDATOR_NUMBER_AND_MESSAGE_REGEX
    )
    expect('.min(123)').toMatch(STRING_VALIDATOR_NUMBER_AND_MESSAGE_REGEX)
  })

  it('should not match STRING_VALIDATOR_NUMBER_AND_MESSAGE_REGEX', () => {
    expect('.email(123, { message: "max" })').not.toMatch(
      STRING_VALIDATOR_NUMBER_AND_MESSAGE_REGEX
    )
    expect('.datetime(123, { message: "max" })').not.toMatch(
      STRING_VALIDATOR_NUMBER_AND_MESSAGE_REGEX
    )
    expect('.min()').not.toMatch(STRING_VALIDATOR_NUMBER_AND_MESSAGE_REGEX)
    expect('.max({ message: "max" })').not.toMatch(
      STRING_VALIDATOR_NUMBER_AND_MESSAGE_REGEX
    )
    expect('.max({ message: "max" })').not.toMatch(
      STRING_VALIDATOR_NUMBER_AND_MESSAGE_REGEX
    )
  })

  it('should match all validators of STRING_VALIDATOR_NUMBER_AND_MESSAGE_REGEX ', () => {
    expect('.email({ message: "max" })').not.toMatch(
      STRING_VALIDATOR_NUMBER_AND_MESSAGE_REGEX
    )
    expect('.regex(123, { message: "max" })').not.toMatch(
      STRING_VALIDATOR_NUMBER_AND_MESSAGE_REGEX
    )
    expect('.datetime(123, { message: "max" })').not.toMatch(
      STRING_VALIDATOR_NUMBER_AND_MESSAGE_REGEX
    )
    expect('.startsWith(123, { message: "max" })').not.toMatch(
      STRING_VALIDATOR_NUMBER_AND_MESSAGE_REGEX
    )
  })

  it('should not match all validators of STRING_VALIDATOR_MESSAGE_REGEX', () => {
    expect('.startsWith({ message: "max" })').not.toMatch(
      STRING_VALIDATOR_MESSAGE_REGEX
    )
    expect('.min({ message: "max" })').not.toMatch(
      STRING_VALIDATOR_MESSAGE_REGEX
    )
  })
})
