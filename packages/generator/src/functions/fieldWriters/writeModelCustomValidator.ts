/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { writeFieldAdditions } from '.'
import { WriteFieldOptions } from '../../types'

export const writeCustomValidator = ({
  writer,
  field,
  writeOptionalDefaults = false,
}: WriteFieldOptions) => {
  writer
    .conditionalWrite(field.omitInModel(), '// omitted: ')
    .write(`${field.formattedNames.original}: `)
    .write(field.zodCustomValidatorString!)

  writeFieldAdditions({ writer, field, writeOptionalDefaults })
}
