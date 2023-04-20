import {
  writeCustomEnum,
  writeDecimalJsLike,
  writeDecimalJsLikeList,
  writeInclude,
  writeInputJsonValue,
  writeInputObjectType,
  writeIsValidDecimalInput,
  writeJsonValue,
  writeNullableJsonValue,
  writePrismaEnum,
  writeSelect,
  writeTransformJsonNull,
} from '.'
import { FileWriter } from '../classes'
import { CreateFiles } from '../types'

/////////////////////////////////////////////////
// FUNCTION
/////////////////////////////////////////////////

export const writeInputTypeFiles: CreateFiles = ({
  path: outputPath,
  dmmf,
}) => {
  const { inputTypePath } = dmmf.generatorConfig

  // WRITE INDEX FILE
  // ------------------------------------------------------------
  const indexFileWriter = new FileWriter()

  const path = indexFileWriter.createPath(`${outputPath}/${inputTypePath}`)

  if (path) {
    indexFileWriter.createFile(`${path}/index.ts`, ({ writeExport }) => {
      if (dmmf.generatorConfig.createInputTypes) {
        dmmf.schema.inputObjectTypes.prisma.forEach(({ name }) => {
          writeExport(`{ ${name}Schema }`, `./${name}Schema`)
        })
      }

      dmmf.schema.enumTypes.prisma.forEach(({ name }) => {
        writeExport(`{ ${name}Schema }`, `./${name}Schema`)
      })

      dmmf.datamodel.enums.forEach(({ name }) => {
        writeExport(`{ ${name}Schema }`, `./${name}Schema`)
      })

      if (dmmf.schema.hasJsonTypes) {
        writeExport(`{ transformJsonNull }`, `./transformJsonNull`)
        writeExport(`{ NullableJsonValue }`, `./NullableJsonValue`)
        writeExport(`{ InputJsonValue }`, `./InputJsonValue`)
        writeExport(`{ JsonValue }`, `./JsonValue`)
      }

      if (dmmf.schema.hasDecimalTypes) {
        writeExport(`{ DecimalJSLikeSchema }`, `./DecimalJsLikeSchema`)
        writeExport(`{ DecimalJSLikeListSchema }`, `./DecimalJsLikeListSchema`)
        writeExport(`{ isValidDecimalInput }`, `./isValidDecimalInput`)
      }
    })

    ////////////////////////////////////////////////////
    // WRITE HELPER FUNCTIONS & SCHEMAS
    ////////////////////////////////////////////////////

    // JSON
    // ------------------------------------------------------------

    if (dmmf.schema.hasJsonTypes) {
      new FileWriter().createFile(
        `${path}/transformJsonNull.ts`,
        (fileWriter) => writeTransformJsonNull({ fileWriter, dmmf })
      )

      new FileWriter().createFile(`${path}/JsonValue.ts`, (fileWriter) =>
        writeJsonValue({ fileWriter, dmmf })
      )

      new FileWriter().createFile(
        `${path}/NullableJsonValue.ts`,
        (fileWriter) => writeNullableJsonValue({ fileWriter, dmmf })
      )

      new FileWriter().createFile(`${path}/InputJsonValue.ts`, (fileWriter) =>
        writeInputJsonValue({ fileWriter, dmmf })
      )
    }

    // DECIMAL
    // ------------------------------------------------------------

    if (dmmf.schema.hasDecimalTypes) {
      new FileWriter().createFile(
        `${path}/DecimalJsLikeSchema.ts`,
        (fileWriter) => writeDecimalJsLike({ fileWriter, dmmf })
      )

      new FileWriter().createFile(
        `${path}/DecimalJsLikeListSchema.ts`,
        (fileWriter) => writeDecimalJsLikeList({ fileWriter, dmmf })
      )

      new FileWriter().createFile(
        `${path}/isValidDecimalInput.ts`,
        (fileWriter) => writeIsValidDecimalInput({ fileWriter, dmmf })
      )
    }

    ////////////////////////////////////////////////////
    // WRITE ENUMS
    ////////////////////////////////////////////////////

    dmmf.schema.enumTypes.prisma.forEach((enumData) => {
      new FileWriter().createFile(
        `${path}/${enumData.name}Schema.ts`,
        (fileWriter) => writePrismaEnum({ fileWriter, dmmf }, enumData)
      )
    })

    dmmf.datamodel.enums.forEach((enumData) => {
      new FileWriter().createFile(
        `${path}/${enumData.name}Schema.ts`,
        (fileWriter) => writeCustomEnum({ fileWriter, dmmf }, enumData)
      )
    })

    ////////////////////////////////////////////////////
    // SKIP INPUT TYPES
    ////////////////////////////////////////////////////

    if (!dmmf.generatorConfig.createInputTypes) return

    ////////////////////////////////////////////////////
    // WRITER INCLUDE & SELECT
    ////////////////////////////////////////////////////

    dmmf.schema.outputObjectTypes.model.forEach((model) => {
      if (model.hasRelationField()) {
        new FileWriter().createFile(
          `${path}/${model.name}IncludeSchema.ts`,
          (fileWriter) => writeInclude({ fileWriter, dmmf }, model)
        )
      }

      new FileWriter().createFile(
        `${path}/${model.name}SelectSchema.ts`,
        (fileWriter) => writeSelect({ fileWriter, dmmf }, model)
      )
    })

    ////////////////////////////////////////////////////
    // WRITE INPUT TYPE FILES
    ////////////////////////////////////////////////////

    dmmf.schema.inputObjectTypes.prisma.forEach((inputType) => {
      new FileWriter().createFile(
        `${path}/${inputType.name}Schema.ts`,
        (fileWriter) => writeInputObjectType({ fileWriter, dmmf }, inputType)
      )
    })
  }
}
