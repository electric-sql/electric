import { dedent } from 'ts-dedent'
import { MetaData } from '../../migrators'
import {
  SatOpMigrate_Column,
  SatOpMigrate_ForeignKey,
} from '../../_generated/protocol/satellite'

// Local definition of a Prisma model that is used
// when formatting it for inclusion in the schema.prisma file.
type PrismaModel = {
  // Table name in the database
  sourceName: string
  // Table name adjusted according to Prisma naming convention
  mappedName: string
  // List of model fields
  fields: PrismaModelField[]
  // List of table names to which the current model has foreign key references
  references: string[]
}

// Local definition of a Prisma model's field that is used
// when formatting the model.
type PrismaModelField = {
  // Name of the table column in the database
  sourceName: string
  // Column name adjusted according to our naming convention
  mappedName: string
  // The field's Prisma type which includes the native Prisma type and 0+ attributes
  prismaType: { name: string; attributes: string[] }
}

// Process table definitions in the migrations metadata and convert each table
// to a Prisma model.
export function migrationsToPrismaModels(migrationsMetadata: MetaData[]) {
  const models = migrationsMetadata.flatMap(convertMigrationToPrismaModels)
  patchModelsWithBackReferences(models)
  return models
}

function convertMigrationToPrismaModels(migration: MetaData): PrismaModel[] {
  return migration.ops
    .filter((op) => op.table !== undefined)
    .map((op) => {
      const table = op.table!
      const name = table.name
      const fkFields = table.fks.map(convertFKToPrismaModelField)

      return {
        sourceName: name,
        mappedName: mapNameToPrisma(name, true),
        fields: table.columns
          .map((column) =>
            convertTableColumnToPrismaModelField(column, table.pks)
          )
          .concat(fkFields),
        references: table.fks.map(({ pkTable }) => pkTable),
      }
    })
}

// Iterate over the models and fill in back references on those models that have
// foreign keys from other models referencing them.
//
// For example, given the following SQL schema
//
//     CREATE TABLE items (
//       id uuid PRIMARY KEY
//     );
//
//     CREATE TABLE subitems {
//       id uuid PRIMARY KEY,
//       item uuid REFERENCES items(id)
//     );
//
// We expect it to map to the following Prisma schema
//
//     model Items {
//       id       String     @id @db.Uuid
//       subitem  Subitem[]  // <== back reference
//
//       @@map("items")
//     }
//
//     model Subitems {
//       id     String   @id @db.Uuid
//       item   String?  @db.Uuid
//       items  Items?   @relation(fields: [item], references: [id], onDelete: NoAction, onUpdate: NoAction)
//
//       @@map("subitems")
//     }
function patchModelsWithBackReferences(models: PrismaModel[]) {
  const modelsMap = new Map(models.map((model) => [model.sourceName, model]))
  models.forEach((model) => {
    model.references.forEach((tableName) => {
      const referencedModel = modelsMap.get(tableName)
      const backReferenceName = mapNameToPrisma(model.sourceName)
      referencedModel!.fields.push({
        sourceName: backReferenceName,
        mappedName: backReferenceName,
        prismaType: { name: model.mappedName + '[]', attributes: [] },
      })
    })
  })
}

function convertFKToPrismaModelField({
  fkCols,
  pkTable,
  pkCols,
}: SatOpMigrate_ForeignKey) {
  const fieldName = mapNameToPrisma(pkTable)
  return {
    sourceName: fieldName,
    mappedName: fieldName,
    prismaType: {
      name: mapNameToPrisma(pkTable, true),
      attributes: [
        `@relation(fields: ${formatListOfFields(
          // TODO: Map these to Prisma names?
          fkCols
        )}, references: ${formatListOfFields(
          // TODO: Map these to Prisma names?
          pkCols
        )}, onDelete: NoAction, onUpdate: NoAction)`,
      ],
    },
  }
}

// TODO: add NULL/NOT NULL flags
function convertTableColumnToPrismaModelField(
  column: SatOpMigrate_Column,
  pks: string[]
): PrismaModelField {
  const fieldType = mapPgTypeToPrisma(column.pgType!.name)
  if (pks.includes(column.name)) {
    fieldType.attributes.splice(0, 0, '@id')
  }
  return {
    sourceName: column.name,
    mappedName: mapNameToPrisma(column.name),
    prismaType: fieldType,
  }
}

function mapPgTypeToPrisma(type: string) {
  switch (type) {
    case 'bool':
      return { name: 'Boolean', attributes: [] }
    case 'date':
      return { name: 'DateTime', attributes: ['@db.Date'] }
    case 'float4':
      return { name: 'Float', attributes: ['@db.Real'] }
    case 'float8':
      return { name: 'Float', attributes: [] }
    case 'int2':
      return { name: 'Int', attributes: ['@db.SmallInt'] }
    case 'int4':
      return { name: 'Int', attributes: [] }
    case 'int8':
      return { name: 'BigInt', attributes: [] }
    case 'jsonb':
      return { name: 'Json', attributes: ['@db.JsonB'] }
    case 'text':
      return { name: 'String', attributes: [] }
    case 'time':
      return { name: 'DateTime', attributes: ['@db.Time(6)'] }
    case 'timestamp':
      return { name: 'DateTime', attributes: ['@db.Timestamp(6)'] }
    case 'timestamptz':
      return { name: 'DateTime', attributes: ['@db.Timestamptz(6)'] }
    case 'uuid':
      return { name: 'String', attributes: ['@db.Uuid'] }
    case 'varchar':
      return { name: 'String', attributes: ['@db.VarChar'] }
  }
  return { name: type, attributes: [] }
}

export function formatPrismaModel(model: PrismaModel): string {
  return dedent`

  model ${model.mappedName} {
    ${model.fields.map(formatModelField).join('\n')}

    @@map(${quoteString(model.sourceName)})
  }

  `
}

function formatModelField(field: PrismaModelField): string {
  const attributes = []
  if (field.sourceName != field.mappedName) {
    attributes.push(`@map(${quoteString(field.sourceName)})`)
  }
  return [
    field.mappedName,
    field.prismaType.name,
    attributes.concat(field.prismaType.attributes).join('  '),
  ]
    .join('\t')
    .trim()
}

function mapNameToPrisma(str: string, capitalize = false): string {
  const tmp = str.replace(/^[^a-zA-Z0-9]/, '').replaceAll(/[^a-zA-Z0-9_]/g, '_')
  return capitalize ? tmp[0].toUpperCase() + tmp.slice(1) : tmp
}

function formatListOfFields(list: string[]) {
  return `[${list.join(', ')}]`
}

function quoteString(str: string) {
  return '"' + str.replaceAll('"', '\\"') + '"'
}
