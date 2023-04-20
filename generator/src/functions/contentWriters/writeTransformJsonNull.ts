import { type ContentWriterOptions } from '../../types'

export const writeTransformJsonNull = ({
  fileWriter: { writer, writeImport },
  dmmf,
  getSingleFileContent = false,
}: ContentWriterOptions) => {
  const { useMultipleFiles, prismaClientPath } = dmmf.generatorConfig

  // TODO: check how to get DbNUll and JsonNull from PrismaClient without importing the whole namespace

  if (useMultipleFiles && !getSingleFileContent) {
    writeImport('{ Prisma }', prismaClientPath)
  }

  writer
    .newLine()
    .write(`export type NullableJsonInput = `)
    .write(`Prisma.JsonValue | `)
    .write(`null | `)
    .write(`'JsonNull' | `)
    .write(`'DbNull' | `)
    .write(`Prisma.NullTypes.DbNull | `)
    .write(`Prisma.NullTypes.JsonNull;`)
    .blankLine()

  writer
    .write(`export const transformJsonNull = (v?: NullableJsonInput) => `)
    .inlineBlock(() => {
      writer
        .writeLine(`if (!v || v === 'DbNull') return Prisma.DbNull;`)
        .writeLine(`if (v === 'JsonNull') return Prisma.JsonNull;`)
        .writeLine(`return v;`)
    })
    .write(`;`)

  if (useMultipleFiles && !getSingleFileContent) {
    writer.blankLine().writeLine(`export default transformJsonNull;`)
  }
}
