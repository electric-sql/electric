import { WriteFieldOptions } from '../../types'

export const writeJson = ({ writer, field }: WriteFieldOptions) => {
  writer
    .conditionalWrite(field.omitInModel(), '// omitted: ')
    .write(`${field.formattedNames.original}: `)
    .conditionalWrite(field.isRequired, `InputJsonValue`)
    .conditionalWrite(!field.isRequired, `NullableJsonValue`)
    .conditionalWrite(field.isList, `.array()`)
    .conditionalWrite(!field.isRequired, `.optional()`)
    .write(`,`)
    .newLine()
}
