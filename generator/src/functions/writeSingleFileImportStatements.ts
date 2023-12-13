import { type WriteStatements } from '../types'

/////////////////////////////////////////////////
// FUNCTION
/////////////////////////////////////////////////

export const writeSingleFileImportStatements: WriteStatements = (
  dmmf,
  { writer, writeImport }
) => {
  writeImport('{ z }', 'zod')

  writeImport(`type { Prisma }`, `./prismaClient.js`)

  if (dmmf.customImports) {
    dmmf.customImports.forEach((statement) => {
      writer.writeLine(statement)
    })
  }

  writeImport(
    `{ type TableSchema, DbSchema, Relation, ElectricClient, type HKT }`,
    'electric-sql/client/model'
  )

  writeImport(`migrations`, './migrations.js')
}
