import { type WriteStatements } from '../types'

/////////////////////////////////////////////////
// FUNCTION
/////////////////////////////////////////////////

export const writeSingleFileImportStatements: WriteStatements = (
  dmmf,
  { writer, writeImport }
) => {
  const { prismaClientPath } = dmmf.generatorConfig
  writeImport('{ z }', 'zod')

  // Prisma should primarily be imported as a type, but if there are json fields,
  // we need to import the whole namespace because the null transformation
  // relies on the Prisma.JsonNull and Prisma.DbNull objects

  if (dmmf.schema.hasJsonTypes) {
    writeImport(`{ Prisma }`, `${prismaClientPath}`)
  } else {
    writeImport(`type { Prisma }`, `${prismaClientPath}`)
  }

  if (dmmf.customImports) {
    dmmf.customImports.forEach((statement) => {
      writer.writeLine(statement)
    })
  }

  writeImport(
    `{ TableSchema, DbSchema, Relation, ElectricClient, HKT }`,
    'electric-sql/client/model'
  )
}
