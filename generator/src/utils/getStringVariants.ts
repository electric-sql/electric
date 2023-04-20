import _ from 'lodash'

/////////////////////////////////////////
//  TYPES & INTERFACES
/////////////////////////////////////////

export interface StringVariants {
  /**
   * String with original formatting
   */

  original: string
  /**
   * String with camelCase formatting
   * @example 'camelCase'
   */

  camelCase: string
  /**
   * String with PascalCase formatting
   * @example 'PascalCase'
   * @see https://lodash.com/docs/4.17.15#camelCase
   * @see https://lodash.com/docs/4.17.15#upperFirst
   */

  pascalCase: string
  /**
   * String with UPPER_CASE_WITH_LODASH_SEPARATOR formatting
   * @example 'UPPER_CASE_WITH_LODASH_SEPARATOR'
   * @see https://lodash.com/docs/4.17.15#snakeCase
   * @see https://lodash.com/docs/4.17.15#toUpper
   */

  upperCaseLodash: string
  /**
   * String with UPPER CASE WITH SPACE SEPARATOR formatting
   * @example 'UPPER CASE WITH SPACE SEPARATOR'
   * @see https://lodash.com/docs/4.17.15#camelCase
   * @see https://lodash.com/docs/4.17.15#upperCase
   */

  upperCaseSpace: string
}

/////////////////////////////////////////
//  FUNCTION
/////////////////////////////////////////

/**
 * Converts a provided string to different string variants like `camelcase`,
 * `pascalCase`, `upper case with lodash separator` and `uppercase with space separator`
 * @param string string to convert to variants
 * @returns object containing variants of provided string
 */

export function getStringVariants(string: string): StringVariants {
  return {
    original: string,
    camelCase: _.camelCase(string),
    pascalCase: _.upperFirst(_.camelCase(string)),
    upperCaseLodash: _.toUpper(_.snakeCase(string)),
    upperCaseSpace: _.upperCase(_.camelCase(string)),
  }
}
