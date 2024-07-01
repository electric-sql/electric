import { writeModelFields } from '.'
import { ExtendedDMMFModel } from '../../classes'
import { type ContentWriterOptions } from '../../types'
import { writeRelation } from '../fieldWriters'

export const writeModelOrType = (
  {
    fileWriter: {
      writer,
      writeImport,
      writeImportSet,
      writeJSDoc,
      writeHeading,
    },
    dmmf,
    getSingleFileContent = false,
  }: ContentWriterOptions,
  model: ExtendedDMMFModel
) => {
  const { useMultipleFiles, createRelationValuesTypes, inputTypePath } =
    dmmf.generatorConfig

  if (useMultipleFiles && !getSingleFileContent) {
    writeImport('{ z }', 'zod')
    writeImportSet(model.imports)

    if (createRelationValuesTypes && model.hasRelationFields) {
      if (model.hasOptionalJsonFields) {
        writeImport(
          `{ type NullableJsonInput }`,
          `../${inputTypePath}/transformJsonNull`
        )
      }

      writeImportSet(
        new Set(
          model.filterdRelationFields
            .map((field) => {
              return !dmmf.generatorConfig.isMongoDb
                ? [
                    `import { type ${field.type}WithRelations, ${field.type}WithRelationsSchema } from './${field.type}Schema'`,
                  ]
                : [
                    `import { type ${field.type}, ${field.type}Schema } from './${field.type}Schema'`,
                  ]
            })
            .flat()
        )
      )

      if (model.writePartialTypes) {
        writeImportSet(
          new Set(
            model.filterdRelationFields
              .map((field) => {
                return !dmmf.generatorConfig.isMongoDb
                  ? [
                      `import { type ${field.type}PartialWithRelations, ${field.type}PartialWithRelationsSchema } from './${field.type}Schema'`,
                    ]
                  : []
              })
              .flat()
          )
        )
      }
    }
  }

  writer.blankLine()

  writeHeading(`${model.formattedNames.upperCaseSpace} SCHEMA`, 'FAT')

  writer.blankLine()

  writeJSDoc(model.clearedDocumentation)

  writer
    .write(`export const ${model.name}Schema = z.object(`)
    .inlineBlock(() => {
      ;[...model.enumFields, ...model.scalarFields].forEach((field) => {
        writer.conditionalWrite(field.omitInModel(), '// omitted: ')

        writeModelFields({
          writer,
          field,
          model,
          dmmf,
        })
      })
    })
    .write(`)`)

  writer
    .blankLine()
    .write(`export type ${model.name} = z.infer<typeof ${model.name}Schema>`)

  if (model.writePartialTypes) {
    writer.blankLine()

    writeHeading(
      `${model.formattedNames.upperCaseSpace} PARTIAL SCHEMA`,
      'SLIM'
    )

    writer
      .blankLine()
      .write(
        `export const ${model.name}PartialSchema = ${model.name}Schema.partial()`
      )

    writer
      .blankLine()
      .write(
        `export type ${model.name}Partial = z.infer<typeof ${model.name}PartialSchema>`
      )
  }

  // WRITE OPTIONAL DEFAULTS VALUE TYPES
  // -------------------------------------------

  if (model.writeOptionalDefaultValuesTypes) {
    writer.blankLine()

    writeHeading(
      `${model.formattedNames.upperCaseSpace} OPTIONAL DEFAULTS SCHEMA`,
      'SLIM'
    )

    writer
      .blankLine()
      .write(`export const ${model.name}OptionalDefaultsSchema = `)
      .write(`${model.name}Schema.merge(z.object(`)
      .inlineBlock(() => {
        ;[...model.enumFields, ...model.scalarFields].forEach((field) => {
          if (!field.isOptionalDefaultField) return

          const writeOptions = {
            writer,
            field,
            writeOptionalDefaults: true,
          }

          writer.conditionalWrite(field.omitInModel(), '// omitted: ')

          writeModelFields({
            ...writeOptions,
            model,
            dmmf,
          })
        })
      })
      .write(`))`)

    writer
      .blankLine()
      .write(
        `export type ${model.name}OptionalDefaults = z.infer<typeof ${model.name}OptionalDefaultsSchema>`
      )
  }

  // WRITE RELATION VALUE TYPES
  // -------------------------------------------

  if (model.writeRelationValueTypes) {
    writer.blankLine()

    writeHeading(
      `${model.formattedNames.upperCaseSpace} RELATION SCHEMA`,
      'SLIM'
    )

    writer
      .blankLine()
      .write(`export type ${model.name}Relations = `)
      .inlineBlock(() => {
        model.relationFields.forEach((field) => {
          writer
            .conditionalWrite(field.omitInModel(), '// omitted: ')
            .write(field.name)
            .conditionalWrite(!field.isRequired, '?')
            .write(': ')
            .conditionalWrite(
              !dmmf.generatorConfig.isMongoDb,
              `${field.type}WithRelations`
            )
            .conditionalWrite(dmmf.generatorConfig.isMongoDb, `${field.type}`)
            .conditionalWrite(field.isList, '[]')
            .conditionalWrite(!field.isRequired, ' | null')
            .write(';')
            .newLine()
        })
      })
      .write(`;`)
      .blankLine()

    if (model.hasOptionalJsonFields) {
      writer
        .write(
          `export type ${model.name}WithRelations = Omit<z.infer<typeof ${model.name}Schema>, ${model.optionalJsonFieldUnion}> & `
        )
        .inlineBlock(() => {
          model.optionalJsonFields.forEach((field) => {
            writer.write(`${field.name}?: NullableJsonInput;`).newLine()
          })
        })
        .write(` & `)
    } else {
      writer.write(
        `export type ${model.name}WithRelations = z.infer<typeof ${model.name}Schema> & `
      )
    }

    writer.write(`${model.name}Relations`)

    writer
      .blankLine()
      .write(
        `export const ${model.name}WithRelationsSchema: z.ZodType<${model.name}WithRelations> = ${model.name}Schema.merge(z.object(`
      )
      .inlineBlock(() => {
        model.relationFields.forEach((field) => {
          writeRelation({ writer, field })
        })
      })
      .write(`))`)
    // .blankLine();
  }

  // WRITE OPTIONAL DEFAULT RELATION VALUE TYPES
  // -------------------------------------------

  if (model.writeOptionalDefaultsRelationValueTypes) {
    writer.blankLine()

    writeHeading(
      `${model.formattedNames.upperCaseSpace} OPTIONAL DEFAULTS RELATION SCHEMA`,
      'SLIM'
    )

    writer.blankLine()

    if (model.hasOptionalJsonFields) {
      writer
        .write(
          `export type ${model.name}OptionalDefaultsWithRelations = Omit<z.infer<typeof ${model.name}OptionalDefaultsSchema>, ${model.optionalJsonFieldUnion}> & `
        )
        .inlineBlock(() => {
          model.optionalJsonFields.forEach((field) => {
            writer.write(`${field.name}?: NullableJsonInput;`).newLine()
          })
        })
        .write(` & `)
    } else {
      writer.write(
        `export type ${model.name}OptionalDefaultsWithRelations = z.infer<typeof ${model.name}OptionalDefaultsSchema> & `
      )
    }

    writer.write(`${model.name}Relations`)

    writer
      .blankLine()
      .write(
        `export const ${model.name}OptionalDefaultsWithRelationsSchema: z.ZodType<${model.name}OptionalDefaultsWithRelations> = ${model.name}OptionalDefaultsSchema.merge(z.object(`
      )
      .inlineBlock(() => {
        model.relationFields.forEach((field) => {
          writeRelation({ writer, field })
        })
      })
      .write(`))`)
    // .blankLine();
  }

  // WRITE PARTIAL RELATION VALUE TYPES
  // -------------------------------------------

  if (model.writePartialRelationValueTypes) {
    writer.blankLine()

    writeHeading(
      `${model.formattedNames.upperCaseSpace} PARTIAL RELATION SCHEMA`,
      'SLIM'
    )

    writer
      .blankLine()
      .write(`export type ${model.name}PartialRelations = `)
      .inlineBlock(() => {
        model.relationFields.forEach((field) => {
          writer
            .conditionalWrite(field.omitInModel(), '// omitted: ')
            .write(field.name)
            .write('?')
            .write(': ')
            .conditionalWrite(
              !dmmf.generatorConfig.isMongoDb,
              `${field.type}PartialWithRelations`
            )
            .conditionalWrite(dmmf.generatorConfig.isMongoDb, `${field.type}`)
            .conditionalWrite(field.isList, '[]')
            .conditionalWrite(!field.isRequired, ' | null')
            .write(';')
            .newLine()
        })
      })
      .write(`;`)
      .blankLine()

    if (model.hasOptionalJsonFields) {
      writer
        .write(
          `export type ${model.name}PartialWithRelations = Omit<z.infer<typeof ${model.name}PartialSchema>, ${model.optionalJsonFieldUnion}> & `
        )
        .inlineBlock(() => {
          model.optionalJsonFields.forEach((field) => {
            writer.write(`${field.name}?: NullableJsonInput;`).newLine()
          })
        })
        .write(` & `)
    } else {
      writer.write(
        `export type ${model.name}PartialWithRelations = z.infer<typeof ${model.name}PartialSchema> & `
      )
    }

    writer.write(`${model.name}PartialRelations`)

    writer
      .blankLine()
      .write(
        `export const ${model.name}PartialWithRelationsSchema: z.ZodType<${model.name}PartialWithRelations> = ${model.name}PartialSchema.merge(z.object(`
      )
      .inlineBlock(() => {
        model.relationFields.forEach((field) => {
          writeRelation({ writer, field, isPartial: true })
        })
      })
      .write(`)).partial()`)
  }

  if (useMultipleFiles && !getSingleFileContent) {
    writer.blankLine().writeLine(`export default ${model.name}Schema;`)
  }
}
