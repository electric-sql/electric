import { getDMMF } from '@prisma/internals'
import { DMMF } from '@prisma/generator-helper'
import fs from 'fs'

export const loadDMMF = async (
  schemaPath: string
): Promise<[DMMF.Document, string]> => {
  const datamodel = fs.readFileSync(schemaPath, 'utf-8')

  const dmmf = await getDMMF({ datamodel })

  return [dmmf, datamodel]
}
