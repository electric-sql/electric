import { DMMF } from '@prisma/generator-helper'

import { ExtendedDMMFFieldDefaultValidators } from './extendedDMMFFieldDefaultValidators'
import { GeneratorConfig } from '../../schemas'

/////////////////////////////////////////////////
// TYPES
/////////////////////////////////////////////////

export type ZodCustomErrorKey =
  | 'invalid_type_error'
  | 'required_error'
  | 'description'

/////////////////////////////////////////////////
// REGEX
/////////////////////////////////////////////////

export const VALIDATOR_CUSTOM_ERROR_REGEX =
  /(\()(?<object>\{(?<messages>[\w (),'":+\-*#!§$%&/{}[\]=?~><°^]+)\})(\))/

export const VALIDATOR_CUSTOM_ERROR_MESSAGE_REGEX =
  /[ ]?"[\w (),.':+\-*#!§$%&/{}[\]=?~><°^]+"[,]?[ ]?/g

export const VALIDATOR_CUSTOM_ERROR_SPLIT_KEYS_REGEX = /[\w]+(?=:)/g

/////////////////////////////////////////////////
// CONSTANTS
/////////////////////////////////////////////////

export const ZOD_VALID_ERROR_KEYS: ZodCustomErrorKey[] = [
  'invalid_type_error',
  'required_error',
  'description',
]

/////////////////////////////////////////////////
// CLASS
/////////////////////////////////////////////////

export class ExtendedDMMFFieldValidatorCustomErrors extends ExtendedDMMFFieldDefaultValidators {
  protected _validatorCustomError?: string
  readonly zodCustomErrors?: string

  constructor(
    field: DMMF.Field,
    generatorConfig: GeneratorConfig,
    modelName: string
  ) {
    super(field, generatorConfig, modelName)

    this._validatorCustomError = this._setValidatorCustomError()
    this.zodCustomErrors = this._setZodCustomErrors()
  }

  private _setValidatorCustomError() {
    if (!this._validatorMatch) return
    return this._validatorMatch?.groups?.['customErrors']
  }

  private _setZodCustomErrors() {
    if (!this._validatorCustomError) return

    const match = this._validatorCustomError.match(VALIDATOR_CUSTOM_ERROR_REGEX)
    if (!match?.groups?.['messages']) return

    return this._customErrorMessagesValid(match.groups['messages'])
      ? match.groups['object']
      : undefined
  }

  private _customErrorMessagesValid(messages: string) {
    // extract the keys of the custom error messages
    // and split them into an array for further validation
    const customErrorKeysArray = messages
      .replace(VALIDATOR_CUSTOM_ERROR_MESSAGE_REGEX, '')
      .match(VALIDATOR_CUSTOM_ERROR_SPLIT_KEYS_REGEX)

    const isValid = customErrorKeysArray?.every((key) => {
      if (ZOD_VALID_ERROR_KEYS?.includes(key as ZodCustomErrorKey)) return true

      throw new Error(
        `[@zod generator error]: Custom error key '${key}' is not valid. Please check for typos! ${this._errorLocation}`
      )
    })

    return Boolean(isValid)
  }
}
