import { Electric, schema } from '../generated/client'
import { uniqueTabId } from 'electric-sql/util'
import { electrify, ElectricDatabase } from 'electric-sql/wa-sqlite'
import { environment } from '../environments/environment'
import { makeElectricContext } from 'electric-sql/angular'
import { ElectricConfig } from 'electric-sql'
import { authToken } from './auth'
import { LIB_VERSION } from 'electric-sql/version'

export const { provideElectric, injectElectric, ELECTRIC_CLIENT } =
  makeElectricContext<Electric>()

export async function initElectric() {
  const { tabId } = uniqueTabId()
  const scopedDbName = `basic-${LIB_VERSION}-${tabId}.db`

  const config: ElectricConfig = {
    url: environment.ELECTRIC_URL,
    debug: environment.DEV,
  }

  const conn = await ElectricDatabase.init(scopedDbName)

  const electricClient = await electrify(conn, schema, config)

  await electricClient.connect(authToken())

  // Resolves when the shape subscription has been established.
  const shape = await electricClient.db.items.sync()

  await shape.synced
}
