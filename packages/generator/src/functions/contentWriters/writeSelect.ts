import { ExtendedDMMFOutputType } from '../../classes'
import { type ContentWriterOptions } from '../../types'

export const writeSelect = (
  {
    fileWriter: { writer, writeImport, writeImportSet },
    dmmf,
    getSingleFileContent = false,
  }: ContentWriterOptions,
  model: ExtendedDMMFOutputType
) => {
  const { useMultipleFiles, prismaClientPath } = dmmf.generatorConfig

  if (useMultipleFiles && !getSingleFileContent) {
    writeImport('{ z }', 'zod')
    writeImport('type { Prisma }', prismaClientPath)
    writeImportSet(model.selectImports)
  }

  writer
    .blankLine()
    .write(`export const ${model.name}SelectSchema: `)
    .write(`z.ZodType<Prisma.${model.name}Select> = `)
    .write(`z.object(`)
    .inlineBlock(() => {
      model.fields.forEach((field) => {
        if (field.isEnumOutputType()) {
          return writer
            .write(`${field.name}: `)
            .write(`z.boolean()`)
            .write(`.optional(),`)
            .newLine()
        }

        // when using mongodb, there is no `findMany` arg type created even for lists
        // so the basic arg type needs to be used instead

        if (field.writeSelectFindManyField) {
          return writer
            .write(`${field.name}: `)
            .write(`z.union([`)
            .write(`z.boolean(),`)
            .write(`z.lazy(() => ${field.outputType.type}FindManyArgsSchema)`)
            .write(`])`)
            .write(`.optional()`)
            .write(`,`)
            .newLine()
        }

        if (field.writeSelectField) {
          return writer
            .write(`${field.name}: `)
            .write(`z.union([`)
            .write(`z.boolean(),`)
            .write(`z.lazy(() => ${field.outputType.type}ArgsSchema)`)
            .write(`])`)
            .write(`.optional()`)
            .write(`,`)
            .newLine()
        }

        return writer
          .write(`${field.name}: `)
          .write(`z.boolean()`)
          .write(`.optional(),`)
          .newLine()
      })
    })

  writer.write(`).strict()`)

  if (useMultipleFiles && !getSingleFileContent) {
    writer.blankLine().writeLine(`export default ${model.name}SelectSchema;`)
  }
}
