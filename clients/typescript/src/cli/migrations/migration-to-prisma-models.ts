import { dedent } from 'ts-dedent'
import { MetaData } from '../../migrators'
import {
  SatOpMigrate_Table,
  SatOpMigrate_Column,
  SatOpMigrate_ForeignKey,
  SatOpMigrate_EnumType,
} from '../../_generated/protocol/satellite'

// Local definition of a Prisma entity that can be either a model or an enum definition.
type PrismaEntity = {
  type: string
  entity: PrismaModel | PrismaEnum
}

// Local definition of a Prisma model that is used
// when formatting tables for inclusion in the schema.prisma file.
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
  // Whether the column has NOT NULL constraint
  isNullable: boolean
}

// Local definition of a Prisma enum that is used
// when formatting enums for inclusion in the schema.prisma file.
type PrismaEnum = {
  sourceName: string
  mappedName: string
  values: PrismaEnumValue[]
}

type PrismaEnumValue = {
  sourceName: string
  mappedName: string
}

// Process table and enum definitions in the migrations metadata and format them
// as Prisma definitions, all joined into a single result string.
export function migrationsToPrismaSchema(migrationsMetadata: MetaData[]) {
  return migrationsToPrismaEntities(migrationsMetadata)
    .map(formatPrismaEntity)
    .join('\n\n')
}

// Process table and enum definitions in the migrations metadata and convert each table
// to a Prisma model and each enum to a Prisma enum.
function migrationsToPrismaEntities(migrationsMetadata: MetaData[]) {
  const entities = migrationsMetadata.flatMap(convertMigrationToPrismaEntities)
  patchModelsWithBackReferences(entities)
  return entities
}

function convertMigrationToPrismaEntities(migration: MetaData): PrismaEntity[] {
  return migration.ops
    .map((op) => {
      if (op.table !== undefined) {
        return {
          type: 'PrismaModel',
          entity: convertTableToPrismaModel(op.table),
        }
      } else if (op.enumType !== undefined) {
        return { type: 'PrismaEnum', entity: convertEnumToPrisma(op.enumType) }
      }
      return undefined
    })
    .filter((entity) => entity !== undefined) as PrismaEntity[]
}

function convertTableToPrismaModel(table: SatOpMigrate_Table): PrismaModel {
  const name = table.name
  const fkFields = table.fks.map((fk) =>
    convertFKToPrismaModelField(fk, table.columns)
  )

  return {
    sourceName: name,
    mappedName: mapNameToPrisma(name, true),
    fields: table.columns
      .map((column) => convertTableColumnToPrismaModelField(column, table.pks))
      .concat(fkFields),
    references: table.fks.map(({ pkTable }) => pkTable),
  }
}

function convertEnumToPrisma(enumType: SatOpMigrate_EnumType): PrismaEnum {
  return {
    sourceName: enumType.name,
    mappedName: mapNameToPrisma(enumType.name),
    values: enumType.values.map(convertEnumValueToPrisma),
  }
}

function convertEnumValueToPrisma(val: string): PrismaEnumValue {
  return {
    sourceName: val,
    mappedName: mapNameToPrisma(val),
  }
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
function patchModelsWithBackReferences(entities: PrismaEntity[]) {
  const models = entities
    .filter((entity) => entity.type == 'PrismaModel')
    .map((entity) => entity.entity) as PrismaModel[]
  const modelsMap = new Map(models.map((model) => [model.sourceName, model]))
  models.forEach((model) => {
    model.references.forEach((tableName) => {
      const referencedModel = modelsMap.get(tableName)
      const backReferenceName = mapNameToPrisma(model.sourceName)
      referencedModel!.fields.push({
        sourceName: backReferenceName,
        mappedName: backReferenceName,
        prismaType: { name: model.mappedName + '[]', attributes: [] },
        isNullable: false,
      })
    })
  })
}

// TODO(alco): This function only works when fkCols and pkCols each
// contains a single item. More investigation is needed to see how
// Prisma maps composite foreign keys to Prisma relations.
//
// Related:
//
//     - https://stackoverflow.com/a/73124327
//     - https://github.com/prisma/prisma/discussions/12547
//     - https://www.prisma.io/docs/orm/prisma-schema/data-model/relations
//     - https://www.prisma.io/docs/orm/prisma-schema/data-model/relations/many-to-many-relations
//
// An example of a composite foreign key:
//
//     CREATE TABLE test (
//       id1 TEXT,
//       id2 TEXT,
//       PRIMARY KEY (id1, id2)
//     );
//
//     CREATE TABLE test1 (
//       id TEXT PRIMARY KEY,
//       test_id1 TEXT,
//       test_id2 TEXT,
//       FOREIGN KEY (test_id1, test_id2) REFERENCES test (id1, id2)
//     );
function convertFKToPrismaModelField(
  { fkCols, pkTable, pkCols }: SatOpMigrate_ForeignKey,
  columns: SatOpMigrate_Column[]
) {
  const relationScalarColumn = columns.find(
    (column) => column.name == fkCols[0]
  )!
  const fieldName = mapNameToPrisma(pkTable)
  return {
    sourceName: fieldName,
    mappedName: fieldName,
    prismaType: {
      name: mapNameToPrisma(pkTable, true),
      attributes: [
        `@relation(fields: ${formatListOfFields(
          fkCols
        )}, references: ${formatListOfFields(
          pkCols
        )}, onDelete: NoAction, onUpdate: NoAction)`,
      ],
    },
    isNullable: relationScalarColumn.isNullable,
  }
}

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
    isNullable: column.isNullable,
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

function formatPrismaEntity(entity: PrismaEntity) {
  switch (entity.type) {
    case 'PrismaModel':
      return formatPrismaModel(entity.entity as PrismaModel)
    case 'PrismaEnum':
      return formatPrismaEnum(entity.entity as PrismaEnum)
  }
  throw `Unexpected entity type: ${entity.type}`
}

function formatPrismaModel(model: PrismaModel): string {
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
  const nullabilitySuffix = field.isNullable ? '?' : ''
  return [
    field.mappedName,
    field.prismaType.name + nullabilitySuffix,
    attributes.concat(field.prismaType.attributes).join('  '),
  ]
    .join('\t')
    .trim()
}

export function formatPrismaEnum(prismaEnum: PrismaEnum): string {
  return dedent`
  enum ${prismaEnum.mappedName} {
    ${prismaEnum.values.map((val) => val.mappedName).join('\n')}
  }
  `
}

// TODO(alco): We need to double-check all uses of this function to make sure
// we correctly implement Prisma's name mangling behaviour.
function mapNameToPrisma(str: string, capitalize = false): string {
  const tmp = str.replace(/^[^a-zA-Z0-9]/, '').replaceAll(/[^a-zA-Z0-9_]/g, '_')
  return capitalize ? tmp[0].toUpperCase() + tmp.slice(1) : tmp
}

function formatListOfFields(list: string[]) {
  return `[${list.map((name) => mapNameToPrisma(name)).join(', ')}]`
}

function quoteString(str: string) {
  return '"' + str.replaceAll('"', '\\"') + '"'
}
