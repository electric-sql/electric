import { ExtendedDMMFOutputType } from '../../classes'
import { type ContentWriterOptions } from '../../types'

/**
 * The args schema is used in "include" and "select" schemas
 */
export const writeArgs = (
  {
    fileWriter: { writer, writeImport },
    dmmf,
    getSingleFileContent = false,
  }: ContentWriterOptions,
  model: ExtendedDMMFOutputType
) => {
  const { useMultipleFiles, prismaClientPath, inputTypePath } =
    dmmf.generatorConfig

  if (useMultipleFiles && !getSingleFileContent) {
    writeImport('{ z }', 'zod')
    writeImport('type { Prisma }', prismaClientPath)
    writeImport(
      `{ ${model.name}SelectSchema }`,
      `../${inputTypePath}/${model.name}SelectSchema`
    )
    writeImport(
      `{ ${model.name}IncludeSchema }`,
      `../${inputTypePath}/${model.name}IncludeSchema`
    )
  }

  writer
    .blankLine()
    .write(`export const ${model.name}ArgsSchema: `)
    .write(`z.ZodType<Prisma.${model.name}Args> = `)
    .write(`z.object(`)
    .inlineBlock(() => {
      writer
        .write(`select: `)
        .write(`z.lazy(() => ${model.name}SelectSchema).optional(),`)
        .newLine()
        .conditionalWrite(
          model.hasRelationField(),
          `include: z.lazy(() => ${model.name}IncludeSchema).optional(),`
        )
    })
    .write(`).strict();`)

  if (useMultipleFiles && !getSingleFileContent) {
    writer.blankLine().writeLine(`export default ${model.name}ArgsSchema;`)
  }
}
