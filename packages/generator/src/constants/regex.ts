/* eslint-disable no-useless-escape */
/////////////////////////////////////////////
// REGEX
/////////////////////////////////////////////

// VALIDATOR TYPE AND KEY REGEX
// ----------------------------------------

export const VALIDATOR_TYPE_REGEX =
  /@zod\.(?<type>[\w]+){1}(?<customErrors>\({[\w (),'":+\-*#!§$%&\/{}[\]=?~><°^]+}\))?(?<validatorPattern>[\w (),.'"\\:+\-*#!§$%&\/{}[\]=?~><°^]+[)])?/

export const VALIDATOR_TYPE_IS_VALID_REGEX = /string|number|bigint|date|custom/

export const VALIDATOR_KEY_REGEX = /(\.(?<validatorKey>[\w]+))/

export const VALIDATOR_CUSTOM_ERROR_REGEX =
  /(\()(?<object>\{(?<messages>[\w (),'":+\-*#!§$%&\/{}\[\]=?~><°^]+)\})(\))/

export const VALIDATOR_CUSTOM_ERROR_MESSAGE_REGEX =
  /[ ]?"[\w (),.':+\-*#!§$%&\/{}\[\]=?~><°^]+"[,]?[ ]?/g

export const VALIDATOR_CUSTOM_ERROR_SPLIT_KEYS_REGEX = /[\w]+(?=:)/g

export const VALIDATOR_CUSTOM_ERROR_REGEX_ALT =
  /(?<opening>\(\{)(?<messages>[\w,": ]+)(?<closing>\}\))/

// STRING
// ----------------------------------------

export const STRING_VALIDATOR_NUMBER_AND_MESSAGE_REGEX =
  /.(?<validator>min|max|length)(?<number>\([\d]+([,][ ]?)?(?<message>[{][ ]?message:[ ]?['"][\w\W]+['"][ ]?[}])?\))/

export const STRING_VALIDATOR_MESSAGE_REGEX =
  /(?<validator>email|url|uuid|cuid|trim|datetime|noDefault)(\((?<message>[{][ ]?message:[ ]?['"][\w\W]+['"][ ]?[}])?\))/

export const STRING_VALIDATOR_REGEX = /.(regex)(\((?<message>.*)\))/

export const STRING_VALIDATOR_STRING_AND_MESSAGE_REGEX =
  /.(?<validator>startsWith|endsWith)\((?<string>['"][\w\W]+['"])([,][ ]?)?(?<message>[{][ ]?message:[ ]?['"][\w\W]+['"][ ]?[}])?\)/

// NUMBER
// ----------------------------------------

export const NUMBER_VALIDATOR_NUMBER_AND_MESSAGE_REGEX =
  /.(?<validator>gt|gte|lt|lte|multipleOf)(?<number>\([\d]+([,][ ]?)?(?<message>[{][ ]?message:[ ]?['"][\w\W]+['"][ ]?[}])?\))/

export const NUMBER_VALIDATOR_MESSAGE_REGEX =
  /.(?<validator>int|positive|nonnegative|negative|nonpositive|finite|noDefault)(\((?<message>[{][ ]?message:[ ]?['"][\w\W]+['"][ ]?[}])?\))/

// DATE
// ----------------------------------------

export const DATE_VALIDATOR_NUMBER_AND_MESSAGE_REGEX =
  /.(?<validator>min|max)(\()(?<date>(new Date\((['"\d-]+)?\)))([,][ ]?)?(?<message>[{][ ]?message:[ ]?['"][\w\W]+['"][ ]?[}])?\)/

// CUSTOM
// ----------------------------------------

export const CUSTOM_VALIDATOR_MESSAGE_REGEX =
  /(?<validator>use|omit|array)(\()(?<custom>[\w (),.'":+\-*#!§$%&\/{}\[\]=?~><°^]+)\)/

// PRISMA FUNCTION TYPES W/ VALIDATORS
// ----------------------------------------

export const PRISMA_FUNCTION_TYPES_WITH_VALIDATORS =
  /CreateInput|CreateMany|UpdateInput|UpdateMany/

export const PRISMA_FUNCTION_TYPES_WITH_VALIDATORS_WHERE_UNIQUE =
  /CreateInput|CreateMany|UpdateInput|UpdateMany|WhereUnique/

// IMPORT STATEMENT
// ----------------------------------------

export const IMPORT_STATEMENT_REGEX_PATTERN =
  /@zod\.(?<type>[\w]+)(\(\[)(?<imports>[\w "'${}/,;.*]+)(\]\))/

export const IMPORT_STATEMENT_REGEX = /"(?<statement>[\w "'${}/,;.*]+)"/
