import { writeFieldAdditions } from '.'
import { WriteFieldOptions } from '../../types'

export const writeBytes = ({
  writer,
  field,
  writeOptionalDefaults = false,
}: WriteFieldOptions) => {
  writer
    .conditionalWrite(field.omitInModel(), '// omitted: ')
    .write(`${field.formattedNames.original}: `)
    .write(`z.instanceof(Buffer)`)

  writeFieldAdditions({ writer, field, writeOptionalDefaults })
}
