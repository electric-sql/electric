import { makeElectricContext } from 'electric-sql/react'

import { electrify, ElectricDatabase } from 'electric-sql/wa-sqlite'
import { Electric, dbSchema } from './generated/client'
export type { issue as Issue } from './generated/client'


export const { ElectricProvider, useElectric } = makeElectricContext<Electric>()

const discriminator = 'prod-13'
const distPath = '/'

const config = {
  auth: {
    token: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJsb2NhbC1kZXZlbG9wbWVudCIsInR5cGUiOiJhY2Nlc3MiLCJ1c2VyX2lkIjoidGVzdC11c2VyIiwiaWF0IjoxNjg3ODc3OTQ1LCJleHAiOjE2OTc4ODE1NDV9.L5Ui2sA9o5MeYDuy67u9lBV-2FzpOWL9dKcitRvgorg',
  }
}

const dbName = `${discriminator}.db`

console.log(dbName)

export const initElectric = async () => {
  const conn = await ElectricDatabase.init(dbName, distPath)
  console.log("initElectric");
  console.log(conn);
  console.log(dbSchema);
  console.log(config);

  return electrify(conn, dbSchema, config)
}