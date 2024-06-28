import {
  writeArgs,
  writeCountArgs,
  writeCountSelect,
  writeOutputObjectType,
} from './contentWriters'
import { FileWriter } from '../classes'
import { CreateFiles } from '../types'

/////////////////////////////////////////////////
// FUNCTION
/////////////////////////////////////////////////

export const writeArgTypeFiles: CreateFiles = ({ path: outputPath, dmmf }) => {
  if (!dmmf.generatorConfig.createInputTypes) return

  const { outputTypePath } = dmmf.generatorConfig

  // WRITE INDEX FILE
  // ------------------------------------------------------------
  const indexFileWriter = new FileWriter()

  const path = indexFileWriter.createPath(`${outputPath}/${outputTypePath}`)

  if (path) {
    indexFileWriter.createFile(`${path}/index.ts`, ({ writeExport }) => {
      dmmf.schema.outputObjectTypes.model.forEach((model) => {
        if (model.hasRelationField()) {
          writeExport(
            `{ ${model.name}ArgsSchema }`,
            `./${model.name}ArgsSchema`
          )
        }
      })
      dmmf.schema.outputObjectTypes.argTypes.forEach((outputType) => {
        outputType.prismaActionFields.forEach((field) => {
          writeExport(`{ ${field.argName}Schema }`, `./${field.argName}Schema`)
        })
      })
    })

    ////////////////////////////////////////////////////
    // INCLUDE SELECT ARGS
    ////////////////////////////////////////////////////

    dmmf.schema.outputObjectTypes.model.forEach((model) => {
      if (model.writeIncludeArgs()) {
        new FileWriter().createFile(
          `${path}/${model.name}ArgsSchema.ts`,
          (fileWriter) => writeArgs({ fileWriter, dmmf }, model)
        )
      }

      if (model.writeCountArgs()) {
        new FileWriter().createFile(
          `${path}/${model.name}CountOutputTypeArgsSchema.ts`,
          (fileWriter) => writeCountArgs({ fileWriter, dmmf }, model)
        )

        new FileWriter().createFile(
          `${path}/${model.name}CountOutputTypeSelectSchema.ts`,
          (fileWriter) => writeCountSelect({ fileWriter, dmmf }, model)
        )
      }
    })

    ////////////////////////////////////////////////////
    // ARG SCHEMAS
    ////////////////////////////////////////////////////

    dmmf.schema.outputObjectTypes.argTypes.forEach((outputType) => {
      outputType.prismaActionFields.forEach((field) => {
        new FileWriter().createFile(
          `${path}/${field.argName}Schema.ts`,
          (fileWriter) => writeOutputObjectType({ fileWriter, dmmf }, field)
        )
      })
    })
  }
}
