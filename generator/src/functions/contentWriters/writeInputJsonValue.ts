import { type ContentWriterOptions } from '../../types'

export const writeInputJsonValue = ({
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
      `export const InputJsonValue: z.ZodType<Prisma.InputJsonValue> = z.union([`
    )
    .withIndentationLevel(1, () => {
      writer
        .writeLine(`z.string(),`)
        .writeLine(`z.number(),`)
        .writeLine(`z.boolean(),`)
        .writeLine(`z.lazy(() => z.array(InputJsonValue.nullable())),`)
        .writeLine(`z.lazy(() => z.record(InputJsonValue.nullable())),`)
    })
    .write(`]);`)
    .blankLine()
    .writeLine(
      `export type InputJsonValueType = z.infer<typeof InputJsonValue>;`
    )

  if (useMultipleFiles && !getSingleFileContent) {
    writer.blankLine().writeLine(`export default InputJsonValue;`)
  }
}
