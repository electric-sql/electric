import { DMMF } from '@prisma/generator-helper'

import { ExtendedDMMFFieldValidatorType } from './extendedDMMFFieldValidatorType'
import { GeneratorConfig } from '../../schemas'

/////////////////////////////////////////////////
// CLASS
/////////////////////////////////////////////////

export class ExtendedDMMFFieldValidatorPattern extends ExtendedDMMFFieldValidatorType {
  protected _validatorPattern?: string
  protected _validatorList?: string[]

  constructor(
    field: DMMF.Field,
    generatorConfig: GeneratorConfig,
    modelName: string
  ) {
    super(field, generatorConfig, modelName)

    this._validatorPattern = this._getValidatorPattern()
    this._validatorList = this._getValidatorList()
  }

  // GET VALIDATOR PATTERN
  // ----------------------------------------------

  private _getValidatorPattern() {
    if (!this._validatorMatch) return
    return this._validatorMatch?.groups?.['validatorPattern']
  }

  // GET VALIDATOR LIST
  // ----------------------------------------------

  private _getValidatorList() {
    if (!this._validatorPattern) return

    const splitIndices = this._getSplitIndices(this._validatorPattern)

    return this._getPatternListFromSplitIndices(
      this._validatorPattern,
      splitIndices
    )
  }

  // Programmatic approach to split the validator pattern
  // is used, because handling nested parentheses is
  // quite tricky with regex.

  protected _getSplitIndices(string: string) {
    const splitIndices = [0]
    let depth = 0

    ;[...string].forEach((char, idx) => {
      if (!depth && !this._isWordChar(char)) {
        const splitPosition = string.substring(0, idx).match(/\.\w+$/)?.index
        if (splitPosition) splitIndices.push(splitPosition)
      }

      if (char === '(') depth++
      if (char === ')') depth--
    })

    return splitIndices
  }

  protected _isWordChar(char: string) {
    return /\w/.test(char)
  }

  protected _getPatternListFromSplitIndices(
    patternString: string,
    splitIndices: number[]
  ) {
    return splitIndices
      .map((splitIndex, idx) =>
        patternString.substring(splitIndex, splitIndices[idx + 1])
      )
      .filter((str): str is string => !!str)
  }

  // HELPER
  // ----------------------------------------------

  protected _getZodValidatorListWithoutArray() {
    return this._validatorList?.filter((elem) => !elem.includes('.array'))
  }

  protected _getZodValidatorListArray() {
    return this._validatorList?.filter((elem) => elem.includes('.array'))
  }
}
