/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { writeFieldAdditions } from '.'
import { ExtendedWriteFieldOptions } from '../../types'

export const writeDecimal = ({
  writer,
  field,
  model,
  writeOptionalDefaults = false,
}: ExtendedWriteFieldOptions) => {
  writer
    .conditionalWrite(field.omitInModel(), '// omitted: ')
    .write(`${field.formattedNames.original}: `)
    .write(`z.union([`)
    .write(`z.number(),`)
    .write(`z.string(),`)
    .write(`DecimalJSLikeSchema,`)
    .write(`]`)
    .conditionalWrite(!!field.zodCustomErrors, field.zodCustomErrors!)
    .write(`)`)
    .write(`.refine((v) => isValidDecimalInput(v),`)
    .write(
      ` { message: "Field '${field.formattedNames.original}' must be a Decimal. Location: ['Models', '${model.formattedNames.original}']", `
    )
    .write(` })`)

  writeFieldAdditions({ writer, field, writeOptionalDefaults })
}
