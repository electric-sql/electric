/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { writeFieldAdditions } from '.'
import { WriteFieldOptions } from '../../types'

export const writeScalar = ({
  writer,
  field,
  writeOptionalDefaults = false,
}: WriteFieldOptions) => {
  if (field.type === 'DateTime') {
    writer
      .write(`${field.name}: `)
      .conditionalWrite(
        !field.generatorConfig.coerceDate,
        `z.${field.zodType}(`
      )
      .conditionalWrite(
        field.generatorConfig.coerceDate,
        `z.coerce.${field.zodType}(`
      )
      .conditionalWrite(!!field.zodCustomErrors, field.zodCustomErrors!)
      .write(`)`)
      .conditionalWrite(!!field.zodValidatorString, field.zodValidatorString!)

    writeFieldAdditions({ writer, field, writeOptionalDefaults })
  } else {
    writer
      .write(`${field.name}: `)
      .write(`z.${field.zodType}(`)
      .conditionalWrite(!!field.zodCustomErrors, field.zodCustomErrors!)
      .write(`)`)
      .conditionalWrite(!!field.zodValidatorString, field.zodValidatorString!)

    writeFieldAdditions({ writer, field, writeOptionalDefaults })
  }
}
