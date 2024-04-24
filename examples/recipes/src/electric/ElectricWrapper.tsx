import { ReactElement, useEffect, useState } from 'react'
import { makeElectricContext } from 'electric-sql/react'
import { authToken } from './auth.ts'
import { LIB_VERSION } from 'electric-sql/version'
import { uniqueTabId } from 'electric-sql/util'
import { ElectricDatabase, electrify } from 'electric-sql/browser'
import { Electric, schema } from '../generated/client/index.ts'

const { ElectricProvider, useElectric } = makeElectricContext<Electric>()

// eslint-disable-next-line react-refresh/only-export-components
export { useElectric }

const { tabId } = uniqueTabId()
const scopedDbName = `recipes-${LIB_VERSION}-${tabId}.db`

export function ElectricWrapper(props: { children: ReactElement[] | ReactElement }) {
  const [electric, setElectric] = useState<Electric>()

  useEffect(() => {
    let client: Electric

    const init = async () => {
      const config = {
        debug: import.meta.env.DEV,
        url: import.meta.env.ELECTRIC_SERVICE,
      }

      const conn = await ElectricDatabase.init(scopedDbName)
      client = await electrify(conn, schema, config)
      await client.connect(authToken())

      setElectric(client)
    }

    init()

    return () => {
      client?.close()
    }
  }, [])

  if (electric === undefined) {
    return null
  }

  return <ElectricProvider db={electric}>{props.children}</ElectricProvider>
}
