import { type ContentWriterOptions } from '../../types'

export const writeJsonValue = ({
  fileWriter: { writer, writeImport },
  dmmf,
  getSingleFileContent = false,
}: ContentWriterOptions) => {
  const { useMultipleFiles, prismaClientPath } = dmmf.generatorConfig

  if (useMultipleFiles && !getSingleFileContent) {
    writeImport('{ z }', 'zod')
    writeImport('type { Prisma }', prismaClientPath)
  }

  writer
    .blankLine()
    .writeLine(
      `export const JsonValue: z.ZodType<Prisma.JsonValue> = z.union([`
    )
    .withIndentationLevel(1, () => {
      writer
        .writeLine(`z.string(),`)
        .writeLine(`z.number(),`)
        .writeLine(`z.boolean(),`)
        .writeLine(`z.lazy(() => z.array(JsonValue)),`)
        .writeLine(`z.lazy(() => z.record(JsonValue)),`)
    })
    .writeLine(`]);`)
    .blankLine()
    .writeLine(`export type JsonValueType = z.infer<typeof JsonValue>;`)

  if (useMultipleFiles && !getSingleFileContent) {
    writer.blankLine().writeLine(`export default JsonValue`)
  }
}
