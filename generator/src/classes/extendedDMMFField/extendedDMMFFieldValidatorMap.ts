import { ExtendedDMMFFieldValidatorCustomErrors } from './extendedDMMFFieldValidatorCustomErrors'
import { ZodValidatorType } from './extendedDMMFFieldValidatorType'

/////////////////////////////////////////////////
// TYPES
/////////////////////////////////////////////////

export type ZodArrayValidatorKeys = 'array'

export type ZodStringValidatorKeys =
  | ZodArrayValidatorKeys
  | 'max'
  | 'min'
  | 'length'
  | 'email'
  | 'url'
  | 'emoji'
  | 'uuid'
  | 'cuid'
  | 'cuid2'
  | 'ulid'
  | 'regex'
  | 'includes'
  | 'startsWith'
  | 'endsWith'
  | 'datetime'
  | 'ip'
  | 'trim'
  | 'toLowerCase'
  | 'toUpperCase'
  | 'noDefault'

export type ZodNumberValidatorKeys =
  | ZodArrayValidatorKeys
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'int'
  | 'positive'
  | 'nonpositive'
  | 'negative'
  | 'nonnegative'
  | 'multipleOf'
  | 'finite'
  | 'noDefault'

export type ZodDateValidatorKeys = ZodArrayValidatorKeys | 'min' | 'max'

export type ZodBigIntValidatorKeys =
  | ZodArrayValidatorKeys
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'positive'
  | 'nonpositive'
  | 'negative'
  | 'nonnegative'
  | 'multipleOf'

export type ZodCustomValidatorKeys = ZodArrayValidatorKeys | 'use' | 'omit'

export interface ScalarValidatorFnOpts {
  key: string
  pattern: string
}

export type ValidatorFn = (opts: ScalarValidatorFnOpts) => boolean

export type ValidatorFunctionMap = Record<ZodValidatorType, ValidatorFn>

export type ValidatorMap<TKeys extends string> = Record<TKeys, RegExp>

/////////////////////////////////////////////////
// REGEX
/////////////////////////////////////////////////

export const VALIDATOR_KEY_REGEX = /(\.(?<validatorKey>[\w]+))/

// STRING
// ----------------------------------------

export const STRING_VALIDATOR_NUMBER_AND_MESSAGE_REGEX =
  /.(?<validator>min|max|length)(?<number>\([\d]+([,][ ]?)?(?<message>[{][ ]?message:[ ]?['"][\w\W]+['"][ ]?[}])?\))/

export const STRING_VALIDATOR_MESSAGE_REGEX =
  /(?<validator>email|url|emoji|uuid|cuid|cuid2|ulid|ip|toLowerCase|toUpperCase|trim|datetime|noDefault)(\((?<message>[{][ ]?message:[ ]?['"][\w\W]+['"][ ]?[}])?\))/

export const STRING_VALIDATOR_REGEX = /.(regex)(\((?<message>.*)\))/

export const STRING_VALIDATOR_STRING_AND_MESSAGE_REGEX =
  /.(?<validator>startsWith|endsWith|includes)\((?<string>['"][\w\W]+['"])([,][ ]?)?(?<message>[{][ ]?message:[ ]?['"][\w\W]+['"][ ]?[}])?\)/

// NUMBER
// ----------------------------------------

export const NUMBER_VALIDATOR_NUMBER_AND_MESSAGE_REGEX =
  /.(?<validator>gt|gte|lt|lte|multipleOf)(?<number>\([\d]+([,][ ]?)?(?<message>[{][ ]?message:[ ]?['"][\w\W]+['"][ ]?[}])?\))/

export const NUMBER_VALIDATOR_MESSAGE_REGEX =
  /.(?<validator>int|positive|nonnegative|negative|nonpositive|finite|noDefault)(\((?<message>[{][ ]?message:[ ]?['"][\w\W]+['"][ ]?[}])?\))/

// DATE
// ----------------------------------------

export const DATE_VALIDATOR_NUMBER_AND_MESSAGE_REGEX =
  /.(?<validator>min|max)(\()(?<date>(new Date\((['"()\w.-]+)?\)))([,][ ]?)?(?<message>[{][ ]?message:[ ]?['"][\w\W]+['"][ ]?[}])?\)/

// BIGINT
// ----------------------------------------

export const BIGINT_VALIDATOR_NUMBER_AND_MESSAGE_REGEX =
  /.(?<validator>gt|gte|lt|lte|multipleOf)(?<number>\([\w]+([,][ ]?)?(?<message>[{][ ]?message:[ ]?['"][\w\W]+['"][ ]?[}])?\))/

export const BIGINT_VALIDATOR_MESSAGE_REGEX =
  /(?<validator>positive|nonnegative|negative|nonpositive|array)(\((?<message>[{][ ]?message:[ ]?['"][\w\W]+['"][ ]?[}])?\))/

// CUSTOM
// ----------------------------------------

export const CUSTOM_VALIDATOR_MESSAGE_REGEX =
  /(?<validator>use|array|omit)(\()(?<pattern>[\w (),.'":+\-*#!§$%&/{}[\]=?~><°^]+)\)/

export const CUSTOM_OMIT_VALIDATOR_MESSAGE_REGEX =
  /(?<validator>omit)(\()(?<pattern>[\w ,'"[\]]+)\)/

// ARRAY
// ----------------------------------------

export const ARRAY_VALIDATOR_MESSAGE_REGEX =
  /(?<validator>array)(\((?<pattern>[\w (),.'":+\-*#!§$%&/{}[\]=?~><°^]+)\))/

/////////////////////////////////////////////
// REGEX MAPS
/////////////////////////////////////////////

/**
 * Maps the right regex to the right validator key.
 *
 * Used to determine if a validator key is valid for a `string` type.
 * @example myPrismaField: String ///@zod.string.max(10) -> valid
 * @example myPrismaField: String ///@zod.string.positive() -> invalid throws error during generation
 */
export const STRING_VALIDATOR_REGEX_MAP: ValidatorMap<ZodStringValidatorKeys> =
  {
    max: STRING_VALIDATOR_NUMBER_AND_MESSAGE_REGEX,
    min: STRING_VALIDATOR_NUMBER_AND_MESSAGE_REGEX,
    length: STRING_VALIDATOR_NUMBER_AND_MESSAGE_REGEX,
    email: STRING_VALIDATOR_MESSAGE_REGEX,
    url: STRING_VALIDATOR_MESSAGE_REGEX,
    emoji: STRING_VALIDATOR_MESSAGE_REGEX,
    uuid: STRING_VALIDATOR_MESSAGE_REGEX,
    cuid: STRING_VALIDATOR_MESSAGE_REGEX,
    cuid2: STRING_VALIDATOR_MESSAGE_REGEX,
    ulid: STRING_VALIDATOR_MESSAGE_REGEX,
    regex: STRING_VALIDATOR_REGEX,
    includes: STRING_VALIDATOR_STRING_AND_MESSAGE_REGEX,
    startsWith: STRING_VALIDATOR_STRING_AND_MESSAGE_REGEX,
    endsWith: STRING_VALIDATOR_STRING_AND_MESSAGE_REGEX,
    datetime: STRING_VALIDATOR_MESSAGE_REGEX,
    ip: STRING_VALIDATOR_MESSAGE_REGEX,
    trim: STRING_VALIDATOR_MESSAGE_REGEX,
    toLowerCase: STRING_VALIDATOR_MESSAGE_REGEX,
    toUpperCase: STRING_VALIDATOR_MESSAGE_REGEX,
    noDefault: STRING_VALIDATOR_MESSAGE_REGEX,
    array: ARRAY_VALIDATOR_MESSAGE_REGEX,
  }

/**
 * Maps the right regex to the right validator key.
 *
 * Used to determine if a validator key is valid for a `number` type.
 * @example myPrismaField: Int ///@zod.number.gte(10) -> valid
 * @example myPrismaField: Int ///@zod.number.email() -> invalid throws error during generation
 */
export const NUMBER_VALIDATOR_REGEX_MAP: ValidatorMap<ZodNumberValidatorKeys> =
  {
    gt: NUMBER_VALIDATOR_NUMBER_AND_MESSAGE_REGEX,
    gte: NUMBER_VALIDATOR_NUMBER_AND_MESSAGE_REGEX,
    lt: NUMBER_VALIDATOR_NUMBER_AND_MESSAGE_REGEX,
    lte: NUMBER_VALIDATOR_NUMBER_AND_MESSAGE_REGEX,
    multipleOf: NUMBER_VALIDATOR_NUMBER_AND_MESSAGE_REGEX,
    int: NUMBER_VALIDATOR_MESSAGE_REGEX,
    positive: NUMBER_VALIDATOR_MESSAGE_REGEX,
    nonpositive: NUMBER_VALIDATOR_MESSAGE_REGEX,
    negative: NUMBER_VALIDATOR_MESSAGE_REGEX,
    nonnegative: NUMBER_VALIDATOR_MESSAGE_REGEX,
    finite: NUMBER_VALIDATOR_MESSAGE_REGEX,
    noDefault: NUMBER_VALIDATOR_MESSAGE_REGEX,
    array: ARRAY_VALIDATOR_MESSAGE_REGEX,
  }

/**
 * Maps the right regex to the right validator key.
 *
 * Used to determine if a validator key is valid for a `date` type.
 * @example myPrismaField: Date ///@zod.date.min(new Date("1900-01-01") -> valid
 * @example myPrismaField: Date ///@zod.date.email() -> invalid throws error during generation
 */
export const DATE_VALIDATOR_REGEX_MAP: ValidatorMap<ZodDateValidatorKeys> = {
  min: DATE_VALIDATOR_NUMBER_AND_MESSAGE_REGEX,
  max: DATE_VALIDATOR_NUMBER_AND_MESSAGE_REGEX,
  array: ARRAY_VALIDATOR_MESSAGE_REGEX,
}

/**
 * Maps the right regex to the right validator key.
 * Used to determine if a validator key is valid for a `bigint` type.
 * @example myPrismaField: BigInt ///@zod.bigint.array() -> valid
 * @example myPrismaField: BigInt ///@zod.bigint.email() -> invalid throws error during generation
 */

export const BIGINT_VALIDATOR_REGEX_MAP: ValidatorMap<ZodBigIntValidatorKeys> =
  {
    gt: BIGINT_VALIDATOR_NUMBER_AND_MESSAGE_REGEX,
    gte: BIGINT_VALIDATOR_NUMBER_AND_MESSAGE_REGEX,
    lt: BIGINT_VALIDATOR_NUMBER_AND_MESSAGE_REGEX,
    lte: BIGINT_VALIDATOR_NUMBER_AND_MESSAGE_REGEX,
    positive: BIGINT_VALIDATOR_MESSAGE_REGEX,
    nonpositive: BIGINT_VALIDATOR_MESSAGE_REGEX,
    negative: BIGINT_VALIDATOR_MESSAGE_REGEX,
    nonnegative: BIGINT_VALIDATOR_MESSAGE_REGEX,
    multipleOf: BIGINT_VALIDATOR_NUMBER_AND_MESSAGE_REGEX,
    array: ARRAY_VALIDATOR_MESSAGE_REGEX,
  }

export const CUSTOM_VALIDATOR_REGEX_MAP: ValidatorMap<ZodCustomValidatorKeys> =
  {
    use: CUSTOM_VALIDATOR_MESSAGE_REGEX,
    omit: CUSTOM_OMIT_VALIDATOR_MESSAGE_REGEX,
    array: ARRAY_VALIDATOR_MESSAGE_REGEX,
  }

export const ENUM_VALIDATOR_REGEX_MAP: ValidatorMap<ZodArrayValidatorKeys> = {
  array: ARRAY_VALIDATOR_MESSAGE_REGEX,
}

export const OBJECT_VALIDATOR_REGEX_MAP: ValidatorMap<ZodArrayValidatorKeys> = {
  array: ARRAY_VALIDATOR_MESSAGE_REGEX,
}

/////////////////////////////////////////////////
// CLASS
/////////////////////////////////////////////////

export class ExtendedDMMFFieldValidatorMap extends ExtendedDMMFFieldValidatorCustomErrors {
  protected _validatorMap: ValidatorFunctionMap = {
    string: (options) =>
      this._validateRegexInMap(STRING_VALIDATOR_REGEX_MAP, options),
    number: (options) =>
      this._validateRegexInMap(NUMBER_VALIDATOR_REGEX_MAP, options),
    date: (options) =>
      this._validateRegexInMap(DATE_VALIDATOR_REGEX_MAP, options),
    bigint: (options) =>
      this._validateRegexInMap(BIGINT_VALIDATOR_REGEX_MAP, options),
    custom: (options) =>
      this._validateRegexInMap(CUSTOM_VALIDATOR_REGEX_MAP, options),
    enum: (options) =>
      this._validateRegexInMap(ENUM_VALIDATOR_REGEX_MAP, options),
    object: (options) =>
      this._validateRegexInMap(OBJECT_VALIDATOR_REGEX_MAP, options),
  }

  //  VALIDATE REGEX IN MAP
  // ----------------------------------------------

  protected _validateRegexInMap = <TKeys extends string>(
    validationMap: ValidatorMap<TKeys>,
    { pattern, key }: ScalarValidatorFnOpts
  ) => {
    const validate = validationMap[key as keyof ValidatorMap<TKeys>]

    if (!validate) {
      throw new Error(
        `[@zod generator error]: Validator '${key}' is not valid for type '${this.type}', for specified '@zod.[key] or for 'z.array.[key]'. ${this._errorLocation}`
      )
    }

    if (validate.test(pattern)) {
      return true
    }

    throw new Error(
      `[@zod generator error]: Could not match validator '${key}' with validatorPattern '${pattern}'. Please check for typos! ${this._errorLocation}`
    )
  }

  //  VALIDATE PATTERN IN MAP
  // ----------------------------------------------

  protected _validatePatternInMap(opts: ScalarValidatorFnOpts) {
    if (this._validatorType) {
      return this._validatorMap[this._validatorType](opts)
    }

    throw new Error(
      `[@zod generator error]: Validator '${opts.key}' is not valid for type '${this.type}'. ${this._errorLocation}`
    )
  }

  //  GET VALIDATOR KEY FROM PATTERN
  // ----------------------------------------------

  protected _getValidatorKeyFromPattern(pattern: string) {
    const key = pattern.match(VALIDATOR_KEY_REGEX)?.groups?.['validatorKey']

    if (key) {
      return key
    }

    throw new Error(
      `[@zod generator error]: no matching validator key found in '${pattern}'. ${this._errorLocation}`
    )
  }

  //  VALIDATOR IS VALID
  // ----------------------------------------------

  protected _validatorIsValid() {
    return Boolean(
      this._validatorList?.every((pattern) =>
        this._validatePatternInMap({
          pattern,
          key: this._getValidatorKeyFromPattern(pattern),
        })
      )
    )
  }
}
