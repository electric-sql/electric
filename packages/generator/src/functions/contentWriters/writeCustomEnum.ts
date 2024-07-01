import { ExtendedDMMFEnum } from '../../classes'
import { type ContentWriterOptions } from '../../types'

export const writeCustomEnum = (
  {
    fileWriter: { writer, writeImport },
    dmmf,
    getSingleFileContent = false,
  }: ContentWriterOptions,
  { name, values }: ExtendedDMMFEnum
) => {
  const { useMultipleFiles } = dmmf.generatorConfig

  if (useMultipleFiles && !getSingleFileContent) {
    writeImport('{ z }', 'zod')
  }

  writer.blankLine().write(`export const ${name}Schema = z.enum([`)
  values.forEach((value, idx) => {
    const writeComma = idx !== values.length - 1
    writer.write(`'${value.name}'${writeComma ? ',' : ''}`)
  })
  writer
    .write(`]);`)
    .blankLine()
    .writeLine(
      `export type ${name}Type = \`\${z.infer<typeof ${name}Schema>}\``
    )

  if (useMultipleFiles && !getSingleFileContent) {
    writer.blankLine().writeLine(`export default ${name}Schema;`)
  }
}
