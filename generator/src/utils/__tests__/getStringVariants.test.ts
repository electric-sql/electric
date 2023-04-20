import { it, expect } from 'vitest'

import { getStringVariants } from '../getStringVariants'

export const TEST_STRING_ONE = 'MY_TEST_String'
export const TEST_STRING_TWO = 'my Test String'
export const TEST_STRING_THREE = 'my_test_string'

const FORMATTED_STRINGS_ONE = getStringVariants(TEST_STRING_ONE)
const FORMATTED_STRINGS_TWO = getStringVariants(TEST_STRING_TWO)
const FORMATTED_STRINGS_THREE = getStringVariants(TEST_STRING_THREE)

it(`should create string variants of ${TEST_STRING_ONE}`, () => {
  expect(FORMATTED_STRINGS_ONE.original).toBe(TEST_STRING_ONE)
  expect(FORMATTED_STRINGS_ONE.camelCase).toBe('myTestString')
  expect(FORMATTED_STRINGS_ONE.pascalCase).toBe('MyTestString')
  expect(FORMATTED_STRINGS_ONE.upperCaseLodash).toBe('MY_TEST_STRING')
  expect(FORMATTED_STRINGS_ONE.upperCaseSpace).toBe('MY TEST STRING')
})

it(`should create string variants of ${TEST_STRING_TWO}`, () => {
  expect(FORMATTED_STRINGS_TWO.original).toBe(TEST_STRING_TWO)
  expect(FORMATTED_STRINGS_TWO.camelCase).toBe('myTestString')
  expect(FORMATTED_STRINGS_TWO.pascalCase).toBe('MyTestString')
  expect(FORMATTED_STRINGS_TWO.upperCaseLodash).toBe('MY_TEST_STRING')
  expect(FORMATTED_STRINGS_TWO.upperCaseSpace).toBe('MY TEST STRING')
})

it(`should create string variants of ${TEST_STRING_THREE}`, () => {
  expect(FORMATTED_STRINGS_THREE.original).toBe(TEST_STRING_THREE)
  expect(FORMATTED_STRINGS_THREE.camelCase).toBe('myTestString')
  expect(FORMATTED_STRINGS_THREE.pascalCase).toBe('MyTestString')
  expect(FORMATTED_STRINGS_THREE.upperCaseLodash).toBe('MY_TEST_STRING')
  expect(FORMATTED_STRINGS_THREE.upperCaseSpace).toBe('MY TEST STRING')
})
