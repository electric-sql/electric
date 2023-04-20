import { writeFieldAdditions } from '.'
import { WriteFieldOptions } from '../../types'

export const writeEnum = ({
  writer,
  field,
  writeOptionalDefaults = false,
}: WriteFieldOptions) => {
  writer
    .conditionalWrite(field.omitInModel(), '// omitted: ')
    .write(`${field.formattedNames.original}: `)
    .write(`${field.zodType}Schema`)

  writeFieldAdditions({ writer, field, writeOptionalDefaults })
}
