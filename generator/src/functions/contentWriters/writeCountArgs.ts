import { ExtendedDMMFOutputType } from '../../classes'
import { type ContentWriterOptions } from '../../types'

export const writeCountArgs = (
  {
    fileWriter: { writer, writeImport },
    dmmf,
    getSingleFileContent = false,
  }: ContentWriterOptions,
  model: ExtendedDMMFOutputType
) => {
  const { useMultipleFiles, prismaClientPath } = dmmf.generatorConfig

  if (useMultipleFiles && !getSingleFileContent) {
    writeImport('{ z }', 'zod')
    writeImport('type { Prisma }', prismaClientPath)
    writeImport(
      `{ ${model.name}CountOutputTypeSelectSchema }`,
      `./${model.name}CountOutputTypeSelectSchema`
    )
  }

  writer
    .blankLine()
    .write(`export const ${model.name}CountOutputTypeArgsSchema: `)
    .write(`z.ZodType<Prisma.${model.name}CountOutputTypeArgs> = `)
    .write('z.object(')
    .inlineBlock(() => {
      writer.writeLine(
        `select: z.lazy(() => ${model.name}CountOutputTypeSelectSchema).nullish(),`
      )
    })
    .write(`).strict();`)

  if (useMultipleFiles && !getSingleFileContent) {
    writer
      .blankLine()
      .writeLine(`export default ${model.name}CountOutputTypeSelectSchema;`)
  }
}
