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
    .write(`null;`)
    .blankLine()
}
