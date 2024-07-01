import { DMMF } from '@prisma/generator-helper'
import { getDMMF } from '@prisma/internals'
import fs from 'fs'

import { ExtendedDMMF } from '../../src/classes'

export const loadDMMF = async (
  schemaPath: string
): Promise<[DMMF.Document, string]> => {
  const datamodel = fs.readFileSync(schemaPath, 'utf-8')

  const dmmf = await getDMMF({ datamodel })

  return [dmmf, datamodel]
}

export const loadExtendedDMMF = async (
  schemaPath: string
): Promise<ExtendedDMMF> => {
  const [dmmf, datamodel] = await loadDMMF(schemaPath)

  return new ExtendedDMMF(dmmf, {}, datamodel)
}
