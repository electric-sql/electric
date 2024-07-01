import { type ContentWriterOptions } from '../../types'

export const writeNullableJsonValue = ({
  fileWriter: { writer, writeImport },
  dmmf,
  getSingleFileContent = false,
}: ContentWriterOptions) => {
  const { useMultipleFiles } = dmmf.generatorConfig

  if (useMultipleFiles && !getSingleFileContent) {
    writeImport('{ z }', 'zod')
    writeImport('JsonValue', './JsonValue')
  }

  writer
    .blankLine()
    .writeLine(`export const NullableJsonValue = JsonValue`)
    .withIndentationLevel(1, () => {
      writer.writeLine('.nullable();')
    })
    .blankLine()
    .writeLine(
      `export type NullableJsonValueType = z.infer<typeof NullableJsonValue>;`
    )

  if (useMultipleFiles && !getSingleFileContent) {
    writer.blankLine().writeLine(`export default NullableJsonValue;`)
  }
}
