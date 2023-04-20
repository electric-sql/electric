import {
  CreateFileOptions,
  ExtendedDMMF,
  ExtendedDMMFModel,
} from '../../classes'

/*
 * `writeTableDescriptions` loops over the dmmf and outputs table descriptions in this format:
 *
 * const tableDescriptions = {
 *   tableName1: {
 *     fields: [ ... ],
 *     relations: [ ... ],
 *     modelSchema: ...,
 *     ... otherSchemas ...
 *   } as TableDescription<...>,
 *
 *   ...
 *
 *   tableNameN: {
 *     ...
 *   }
 * }
 *
 */

export function writeTableSchemas(
  dmmf: ExtendedDMMF,
  fileWriter: CreateFileOptions
) {
  const writer = fileWriter.writer

  writer.blankLine()

  // Create a HKT interface for every table's GetPayload type
  dmmf.datamodel.models.forEach((model: ExtendedDMMFModel) => {
    const modelName = model.name
    writer
      .write(`interface ${modelName}GetPayload extends HKT `)
      .inlineBlock(() => {
        writer
          .writeLine(
            `readonly _A?: boolean | null | undefined | Prisma.${modelName}Args`
          )
          .writeLine(`readonly type: Prisma.${modelName}GetPayload<this['_A']>`)
      })
      .blankLine()
  })

  // Make an object describing all tables
  writer
    .write(`export const tableSchemas = `)
    .inlineBlock(() => {
      dmmf.datamodel.models.forEach((model: ExtendedDMMFModel) => {
        const modelName = model.name

        writer.write(`${modelName}: `).inlineBlock(() => {
          writer.write('fields: ')
          writeFieldNamesArray(model, fileWriter)

          writer.newLine().write(`relations: `)

          writeRelations(model, fileWriter)
          writeSchemas(model, fileWriter)
        })

        writer.write(' as ')

        writeTableDescriptionType(model, fileWriter)
      })
    })
    .blankLine()

  writer
    .writeLine('export const dbSchema = new DbSchema(tableSchemas)')
    .writeLine('export type Electric = ElectricClient<typeof dbSchema>')
}

export function writeFieldNamesArray(
  model: ExtendedDMMFModel,
  fileWriter: CreateFileOptions
) {
  const fieldsWithoutRelations = model.fields.filter(
    (f) => model.relationFields.indexOf(f) === -1
  )
  const fieldArray = JSON.stringify(
    fieldsWithoutRelations.map((field) => field.name)
  )
  fileWriter.writer.write(`${fieldArray},`)
}

export function writeRelations(
  model: ExtendedDMMFModel,
  fileWriter: CreateFileOptions
) {
  const writer = fileWriter.writer
  writer.write('[').newLine()

  model.relationFields.forEach((field) => {
    const fieldName = field.name
    const relationName = field.relationName

    if (field.relationFromFields!.length > 1)
      throw new Error(
        `Electric does not yet support relations with composite keys. Relation '${relationName}' in model ${
          model.name
        } has several from fields: ${JSON.stringify(field.relationFromFields)}`
      )

    if (field.relationToFields!.length > 1)
      throw new Error(
        `Electric does not yet support relations with composite keys. Relation '${relationName}' in model ${
          model.name
        } has several to fields: ${JSON.stringify(field.relationToFields)}`
      )

    const from =
      field.relationFromFields!.length === 0 ? '' : field.relationFromFields![0]
    const to =
      field.relationToFields!.length === 0 ? '' : field.relationToFields![0]
    const otherTable = field.type // the table with which we have this relation
    const arity = field.isList ? 'many' : 'one'
    writer.writeLine(
      `  new Relation("${fieldName}", "${from}", "${to}", "${otherTable}", "${relationName}", "${arity}"),`
    )
  })

  writer.writeLine('],')
}

export function writeSchemas(
  model: ExtendedDMMFModel,
  fileWriter: CreateFileOptions
) {
  const writer = fileWriter.writer
  const modelName = model.name
  writer
    .writeLine(`modelSchema: (${modelName}CreateInputSchema as any)`)
    .writeLine('  .partial()')
    .writeLine(
      `  .or((${modelName}UncheckedCreateInputSchema as any).partial()),`
    )
    .writeLine(`createSchema: ${modelName}CreateArgsSchema,`)
    .writeLine(`createManySchema: ${modelName}CreateManyArgsSchema,`)
    .writeLine(`findUniqueSchema: ${modelName}FindUniqueArgsSchema,`)
    .writeLine(`findSchema: ${modelName}FindFirstArgsSchema,`)
    .writeLine(`updateSchema: ${modelName}UpdateArgsSchema,`)
    .writeLine(`updateManySchema: ${modelName}UpdateManyArgsSchema,`)
    .writeLine(`upsertSchema: ${modelName}UpsertArgsSchema,`)
    .writeLine(`deleteSchema: ${modelName}DeleteArgsSchema,`)
    .writeLine(`deleteManySchema: ${modelName}DeleteManyArgsSchema`)
}

export function writeTableDescriptionType(
  model: ExtendedDMMFModel,
  fileWriter: CreateFileOptions
) {
  const capitalizeFirstLetter = (string: string) => {
    return string.charAt(0).toUpperCase() + string.slice(1)
  }

  const modelName = model.name
  const capitalizedModelName = capitalizeFirstLetter(modelName)
  let includeType = `Omit<Prisma.${modelName}Include, '_count'>,`
  if (model.relationFields.length === 0) {
    // if the model has no relations, it won't support 'include' arguments
    includeType = 'never,'
  }

  fileWriter.writer
    .write('TableSchema<')
    .newLine()
    .writeLine(`  z.infer<typeof ${modelName}CreateInputSchema>,`)
    .writeLine(`  Prisma.${modelName}CreateArgs['data'],`)
    .writeLine(`  Prisma.${modelName}UpdateArgs['data'],`)
    .writeLine(`  Prisma.${modelName}FindFirstArgs['select'],`)
    .writeLine(`  Prisma.${modelName}FindFirstArgs['where'],`)
    .writeLine(`  Prisma.${modelName}FindUniqueArgs['where'],`)
    .writeLine(`  ${includeType}`)
    .writeLine(`  Prisma.${modelName}FindFirstArgs['orderBy'],`)
    .writeLine(`  Prisma.${capitalizedModelName}ScalarFieldEnum,`)
    .writeLine(`  ${modelName}GetPayload`)
    .writeLine('>,')
}
