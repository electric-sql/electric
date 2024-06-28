import { type WriteStatements } from '../types'

/////////////////////////////////////////////////
// FUNCTION
/////////////////////////////////////////////////

export const writeSingleFileImportStatements: WriteStatements = (
  dmmf,
  { writer, writeImport }
) => {
  writeImport('{ z }', 'zod')

  writeImport(`type { Prisma }`, `./prismaClient`)

  if (dmmf.customImports) {
    dmmf.customImports.forEach((statement) => {
      writer.writeLine(statement)
    })
  }

  const hasRelations = dmmf.datamodel.models.some(
    (model) => model.hasRelationFields
  )

  const imports = [
    'type TableSchema',
    'DbSchema',
    ...(hasRelations ? ['Relation'] : []),
    'ElectricClient',
    'type HKT',
  ]

  writeImport(`{ ${imports.join(', ')} }`, 'electric-sql/client/model')

  writeImport(`migrations`, './migrations')
  writeImport(`pgMigrations`, './pg-migrations')
}
