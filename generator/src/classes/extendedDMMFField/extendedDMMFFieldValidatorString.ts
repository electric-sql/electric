import { DMMF } from '@prisma/generator-helper'

import { ExtendedDMMFFieldValidatorMap } from './extendedDMMFFieldValidatorMap'
import { GeneratorConfig } from '../../schemas'

/////////////////////////////////////////////////
// CLASS
/////////////////////////////////////////////////

export class ExtendedDMMFFieldValidatorString extends ExtendedDMMFFieldValidatorMap {
  readonly zodValidatorString?: string

  constructor(
    field: DMMF.Field,
    generatorConfig: GeneratorConfig,
    modelName: string
  ) {
    super(field, generatorConfig, modelName)

    this.zodValidatorString = this._getZodValidatorString()
  }

  // GET VALIDATOR STRING
  // ----------------------------------------------

  private _getZodValidatorString() {
    if (!this._validatorType || this._validatorType === 'custom')
      return this._defaultValidatorString

    return this._validatorIsValid()
      ? this._getZodValidatorStringWithoutArray()
      : this.zodValidatorString
  }

  // HELPER
  // ----------------------------------------------

  private _getZodValidatorStringWithoutArray() {
    return this._getZodValidatorListWithoutArray()?.join('')
  }
}
