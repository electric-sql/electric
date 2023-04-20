import { DMMF } from '@prisma/generator-helper'

import { OmitFieldMode } from './extendedDMMFFieldOmitField'
import { ExtendedDMMFFieldZodType } from './extendedDMMFFieldZodType'
import { GeneratorConfig } from '../../schemas'
import { FormattedNames } from '../formattedNames'

export interface ExtendedDMMFField extends DMMF.Field, FormattedNames {
  /**
   * Config that is passed to the generator from prisma schema.
   */
  readonly generatorConfig: GeneratorConfig

  /**
   * Inverts the `isRequired` property.
   * Comes in handy when it is about readabilty.
   */
  readonly isNullable: boolean

  /**
   * Is used in writer functions.
   * Makes the code more readable when it is in a seperate property.
   */
  readonly isJsonType: boolean

  /**
   * Is used in writer functions.
   * Makes the code more readable when it is in a seperate property.
   */
  readonly isBytesType: boolean

  /**
   * Is used in writer functions.
   * Makes the code more readable when it is in a seperate property.
   */
  readonly isDecimalType: boolean

  /**
   * Is used in writer functions.
   * Makes the code more readable when it is in a seperate property.
   */
  readonly isOptionalOnDefaultValue: boolean

  /**
   * Is used in writer functions.
   * Makes the code more readable when it is in a seperate property.
   */
  readonly isOptionalDefaultField: boolean

  /**
   * Contains the documentation string provided via rich comments
   * without the `@zod` directives.
   */
  readonly clearedDocumentation?: string

  /**
   * Contains the string that should be used for the field's validator.
   * @description `.min(1).max(10)` for `z.string().min(1).max(10)` on a `String` field
   */
  readonly zodValidatorString?: string

  /**
   * Contains the string that should be used for custom errors on the field's validator.
   * @description `z.string({ invalid_type_error: "my message"})`
   */
  readonly zodCustomErrors?: string

  /**
   * Contains the validator that should be used for the field
   * when the `@zod.custom.use()` directive is used.
   */
  readonly zodCustomValidatorString?: string

  /**
   * Contains validators that can be added to array fields.
   * @description `.nonempty()`, `.min(1)`, `.max(10)`, `.length(5)`
   */
  readonly zodArrayValidatorString?: string

  /**
   * Determins if and in which types the field should be omitted
   * @description `input types`, `model types`, `all types` or `none`
   */
  readonly zodOmitField: OmitFieldMode

  /**
   *  Type that is used when matching prisma types
   *  @description `z.string()` for `String`, `z.number()` for `Int`, etc.
   */
  readonly zodType: string

  /**
   * Determins if the field should be omitted in the model type.
   * Makes the code more readable when it is in a seperate method.
   */
  omitInModel(): boolean

  /**
   * Determins if the field should be omitted in the input types.
   * Makes the code more readable when it is in a seperate method.
   * @param inputTypeName Name of the input type e.g. `UserCreateInput`
   */
  omitInInputTypes(inputTypeName: string): boolean

  /**
   * Determins if the field should be omitted in some of the types.
   * Makes the code more readable when it is in a seperate method.
   */
  isOmitField(): boolean
}

/**
 * This class is used to extend the DMMF Field class with additional properties
 * and methods.
 *
 * The class is structured in multiple sub-classes to keep the code clean,
 * readable and maintainable.
 *
 * The sub-classes are used in the following order and each one extends the previous one:
 * - ExtendedDMMFFieldBase
 * - ExtendedDMMFFieldValidatorMatch
 * - ExtendedDMMFFieldValidatorType
 * - ExtendedDMMFFieldValidatorPattern
 * - ExtendedDMMFFieldDefaultValidators
 * - ExtendedDMMFFieldValidatorCustomErrors
 * - ExtendedDMMFFieldValidatorMap
 * - ExtendedDMMFFieldValidatorString
 * - ExtendedDMMFFieldCustomValidatorString
 * - ExtendedDMMFFieldArrayValidatorString
 * - ExtendedDMMFFieldOmitField
 * - ExtendedDMMFFieldZodType
 */

export class ExtendedDMMFFieldClass
  extends ExtendedDMMFFieldZodType
  implements ExtendedDMMFField {}
