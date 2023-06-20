import { makeElectricContext } from 'electric-sql/react'

import { electrify, ElectricDatabase } from 'electric-sql/wa-sqlite'
import { Electric, dbSchema } from './generated/models'
export type { issue as Issue } from './generated/models'

import config from '../../.electric/@config'

export const { ElectricProvider, useElectric } = makeElectricContext<Electric>()

const discriminator = 'prod-10'
const distPath = '/'

const dbName = `${config.app}-${config.env}-${discriminator}.db`

console.log(dbName)

export const initElectric = async () => {
  const conn = await ElectricDatabase.init(dbName, distPath)
  console.log("initElectric");
  return electrify(conn, dbSchema, config)
}