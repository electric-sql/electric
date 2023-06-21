import { makeElectricContext } from 'electric-sql/react'

import { electrify, ElectricDatabase } from 'electric-sql/wa-sqlite'
import { Electric, dbSchema } from './generated/models'
export type { issue as Issue } from './generated/models'

import config from '../.electric/@config'

export const { ElectricProvider, useElectric } = makeElectricContext<Electric>()

const discriminator = 'prod-11'
const distPath = '/'

const dbName = `${config.app}-${config.env}-${discriminator}.db`

console.log(dbName)

export const initElectric = async () => {
  const conn = await ElectricDatabase.init(dbName, distPath)
  console.log("initElectric");
  console.log(conn);
  console.log(dbSchema);
  console.log(config);

  return electrify(conn, dbSchema, config)
}