import { it, describe, expect } from 'vitest'

import { writeSingleFileImportStatements } from '../../src/functions/writeSingleFileImportStatements'
import { TestFileWriter } from '../testUtils'
import { loadExtendedDMMF } from '../testUtils/loadDMMF'

describe('writeSingleFileImportStatements', () => {
  it('should import Relation class if relations are present', async () => {
    const dmmf = await loadExtendedDMMF(`${__dirname}/withRelations.prisma`)

    // some model should have relations
    expect(dmmf.datamodel.models.some((model) => model.hasRelationFields)).toBe(
      true
    )

    const writer = new TestFileWriter()
    const fileString = writer.createFileString((writer) =>
      writeSingleFileImportStatements(dmmf, writer)
    )
    expect(fileString).toContain(
      "import { type TableSchema, DbSchema, Relation, ElectricClient, type HKT } from 'electric-sql/client/model';"
    )
  })

  it('should not import Relation class if relations are not present', async () => {
    const dmmf = await loadExtendedDMMF(`${__dirname}/withoutRelations.prisma`)

    // models should have no relations
    expect(
      dmmf.datamodel.models.every((model) => !model.hasRelationFields)
    ).toBe(true)

    const writer = new TestFileWriter()
    const fileString = writer.createFileString((writer) =>
      writeSingleFileImportStatements(dmmf, writer)
    )

    expect(fileString).toContain(
      "import { type TableSchema, DbSchema, ElectricClient, type HKT } from 'electric-sql/client/model';"
    )
  })
})
