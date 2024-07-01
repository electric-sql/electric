/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { WriteFieldOptions } from '../../types'

/**
 * Writes all relevant additional zod modifiers like`.nullish().array().optional()` to a field
 */
export const writeFieldAdditions = ({
  writer,
  field,
  writeOptionalDefaults = false,
}: WriteFieldOptions) => {
  const { writeNullishInModelTypes } = field.generatorConfig

  writer
    .conditionalWrite(field.isList, `.array()`)
    .conditionalWrite(
      !!field.zodArrayValidatorString,
      field.zodArrayValidatorString!
    )
    .conditionalWrite(
      field.isNullable &&
        !field.isOptionalOnDefaultValue &&
        !writeNullishInModelTypes,
      `.nullable()`
    )
    .conditionalWrite(
      field.isNullable &&
        !field.isOptionalOnDefaultValue &&
        writeNullishInModelTypes,
      `.nullish()`
    )
    .conditionalWrite(
      writeOptionalDefaults && field.isOptionalOnDefaultValue,
      `.optional()`
    )
    .write(`,`)
    .newLine()
}
