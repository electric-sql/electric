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

  writeImport(
    `{ TableSchema, DbSchema, Relation, ElectricClient, HKT }`,
    'electric-sql/client/model'
  )

  writeImport(`migrations`, './migrations')
}
