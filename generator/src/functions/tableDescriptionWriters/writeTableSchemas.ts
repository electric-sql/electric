import { Attribute } from 'src/utils/schemaParser'
import {
  CreateFileOptions,
  ExtendedDMMF,
  ExtendedDMMFField,
  ExtendedDMMFModel,
} from '../../classes'

/*
 * `writeTableSchemas` loops over the dmmf and outputs table descriptions in this format:
 *
 * const tableSchemas = {
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
        const tableName = model.dbName ?? model.name

        writer.write(`${tableName}: `).inlineBlock(() => {
          writer.write('fields: ')
          writeFieldsMap(model, fileWriter)

          writer.newLine().write(`relations: `)

          const modelNameMappings = new Map(
            dmmf.datamodel.models.map((m) => [m.name, m.dbName ?? m.name])
          ) // mapping of model names to their DB name
          writeRelations(model, fileWriter, modelNameMappings)
          writeSchemas(model, fileWriter)
        })

        writer.write(' as ')

        writeTableDescriptionType(model, fileWriter)
      })
    })
    .blankLine()

  writer
    .writeLine('export const schema = new DbSchema(tableSchemas, migrations)')
    .writeLine('export type Electric = ElectricClient<typeof schema>')
    .conditionalWriteLine(
      dmmf.schema.hasJsonTypes,
      'export const JsonNull = { __is_electric_json_null__: true }'
    )
}

export function writeFieldsMap(
  model: ExtendedDMMFModel,
  fileWriter: CreateFileOptions
) {
  const fieldsWithoutRelations = model.fields.filter(
    (f) => model.relationFields.indexOf(f) === -1
  )
  const fieldArray = JSON.stringify(
    fieldsWithoutRelations.map((field) => [
      field.name,
      pgType(field, model.name),
    ]),
    null,
    2
  )
  fileWriter.writer.write(`new Map(${fieldArray}),`)
}

function pgType(field: ExtendedDMMFField, modelName: string): string {
  const prismaType = field.type
  const attributes = field.attributes
  const getTypeAttribute = () =>
    attributes.find((a) => a.type.startsWith('@db'))
  switch (prismaType) {
    case 'String':
      return stringToPg(getTypeAttribute())
    case 'Int':
      return intToPg(getTypeAttribute())
    case 'Boolean':
      return 'BOOL'
    case 'DateTime':
      return dateTimeToPg(getTypeAttribute(), field.name, modelName)
    case 'BigInt':
      return 'INT8'
    case 'Bytes':
      return 'BYTEA'
    case 'Decimal':
      return 'DECIMAL'
    case 'Float':
      return floatToPg(getTypeAttribute())
    case 'Json':
      return jsonToPg(attributes)
    default:
      if (field.kind === 'enum') return 'TEXT' // treat enums as TEXT such that the ts-client correctly serializes/deserialises them as text
      return 'UNRECOGNIZED PRISMA TYPE'
  }
}

function floatToPg(pgTypeAttribute: Attribute | undefined): string {
  if (!pgTypeAttribute || pgTypeAttribute.type === '@db.DoublePrecision') {
    // If Prisma did not add a type attribute then the PG type was FLOAT8
    return 'FLOAT8'
  } else {
    return 'FLOAT4'
  }
}

function jsonToPg(attributes: Array<Attribute>) {
  const pgTypeAttribute = attributes.find((a) => a.type.startsWith('@db'))
  if (pgTypeAttribute && pgTypeAttribute.type === '@db.Json') {
    return 'JSON'
  } else {
    // default mapping for Prisma's `Json` type is PG's JSONB
    return 'JSONB'
  }
}

function dateTimeToPg(
  a: Attribute | undefined,
  field: string,
  model: string
): string {
  const type = a?.type
  const mapping = new Map([
    ['@db.Timestamptz', 'TIMESTAMPTZ'],
    ['@db.Time', 'TIME'],
    ['@db.Timetz', 'TIMETZ'],
    ['@db.Date', 'DATE'],
    ['@db.Timestamp', 'TIMESTAMP'],
  ])

  if (!type) {
    // No type attribute provided
    // Prisma defaults to `@db.Timestamp`
    // i.e. Prisma does not add the type attribute
    //      if the PG type is `timestamp`
    return 'TIMESTAMP'
  } else {
    const pgType = mapping.get(type)
    if (!pgType) {
      throw new Error(
        `Unrecognized type attribute '${type}' for field '${field}' in model '${model}'.`
      )
    }
    return pgType
  }
}

function stringToPg(pgTypeAttribute: Attribute | undefined) {
  if (!pgTypeAttribute || pgTypeAttribute.type === '@db.Text') {
    // If Prisma does not add a type attribute then the PG type was TEXT
    return 'TEXT'
  } else if (pgTypeAttribute.type === '@db.Uuid') {
    return 'UUID'
  } else {
    return 'VARCHAR'
  }
}

function intToPg(pgTypeAttribute: Attribute | undefined) {
  if (pgTypeAttribute?.type === '@db.SmallInt') {
    return 'INT2'
  } else {
    return 'INT4'
  }
}

export function writeRelations(
  model: ExtendedDMMFModel,
  fileWriter: CreateFileOptions,
  modelNames2DbNames: Map<string, string>
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
    const otherTable = modelNames2DbNames.get(field.type)! // the table with which we have this relation
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
