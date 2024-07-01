import { DMMF } from '@prisma/generator-helper'

import { ExtendedDMMFFieldBase } from './extendedDMMFFieldBase'
import { GeneratorConfig } from '../../schemas'

/////////////////////////////////////////////////
// REGEX
/////////////////////////////////////////////////

export const VALIDATOR_TYPE_REGEX =
  /@zod\.(?<type>[\w]+){1}(?<customErrors>\({[\w (),'":+\-*#!§$%&/{}[\]=?~><°^]+}\))?(?<validatorPattern>[\w (),.'"\\:+\-*#!§$%&/{}[\]=?~><°^]+[)])?/

/////////////////////////////////////////////////
// CLASS
/////////////////////////////////////////////////

export class ExtendedDMMFFieldValidatorMatch extends ExtendedDMMFFieldBase {
  protected _validatorMatch?: RegExpMatchArray
  readonly clearedDocumentation?: string

  constructor(
    field: DMMF.Field,
    generatorConfig: GeneratorConfig,
    modelName: string
  ) {
    super(field, generatorConfig, modelName)

    this._validatorMatch = this._getValidatorMatchArray()
    this.clearedDocumentation = this._getClearedDocumentation()
  }

  private _getValidatorMatchArray() {
    if (!this.documentation) return
    return this.documentation.match(VALIDATOR_TYPE_REGEX) ?? undefined
  }

  private _getClearedDocumentation() {
    if (!this.documentation) return
    return (
      this.documentation.replace(VALIDATOR_TYPE_REGEX, '').trim() || undefined
    )
  }
}
