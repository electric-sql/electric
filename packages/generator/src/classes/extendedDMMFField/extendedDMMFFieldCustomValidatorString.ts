import { DMMF } from '@prisma/generator-helper'

import { CUSTOM_VALIDATOR_MESSAGE_REGEX } from './extendedDMMFFieldValidatorMap'
import { ExtendedDMMFFieldValidatorString } from './extendedDMMFFieldValidatorString'
import { GeneratorConfig } from '../../schemas'

/////////////////////////////////////////////////
// CLASS
/////////////////////////////////////////////////

export class ExtendedDMMFFieldCustomValidatorString extends ExtendedDMMFFieldValidatorString {
  readonly zodCustomValidatorString?: string

  constructor(
    field: DMMF.Field,
    generatorConfig: GeneratorConfig,
    modelName: string
  ) {
    super(field, generatorConfig, modelName)

    this.zodCustomValidatorString = this._getZodCustomValidatorString()
  }

  // GET CUSTOM VALIDATOR STRING
  // ----------------------------------------------

  private _getZodCustomValidatorString() {
    if (!this._validatorType || this._validatorType !== 'custom')
      return this.zodCustomValidatorString

    return this._validatorIsValid()
      ? this._extractUsePattern()
      : this.zodCustomValidatorString
  }

  // HELPER
  // ----------------------------------------------

  private _extractUsePattern() {
    return this._getZodValidatorListWithoutArray()
      ?.find((pattern) => pattern.includes('.use'))
      ?.match(CUSTOM_VALIDATOR_MESSAGE_REGEX)?.groups?.['pattern']
  }
}
