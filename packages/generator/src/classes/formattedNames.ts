import { getStringVariants, StringVariants } from '../utils/getStringVariants'

/////////////////////////////////////////
//  IMPLEMENTATION
/////////////////////////////////////////

export class FormattedNames {
  /**
   * provides camelCase, PascalCase, lodash separated, string separated
   * and original version of the provided name
   */
  readonly formattedNames: StringVariants

  constructor(string: string) {
    this.formattedNames = this.getStringVariants(string)
  }

  /**
   * Converts a provided string to different string variants like `camelcase`,
   * `pascalCase`, `upper case with lodash separator` and `uppercase with space separator`
   * @param string string to convert to variants
   * @returns object containing variants of provided string
   */
  getStringVariants = getStringVariants
}
