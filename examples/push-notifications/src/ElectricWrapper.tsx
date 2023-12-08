import React, { ReactElement, useEffect, useState } from 'react'
import { makeElectricContext } from 'electric-sql/react'
import { authToken } from './auth'
import { DEBUG_MODE, ELECTRIC_URL } from './config'
import { uniqueTabId } from 'electric-sql/util'
import { ElectricDatabase, electrify } from 'electric-sql/browser'
import { Electric, schema } from './generated/client'

const { ElectricProvider, useElectric } = makeElectricContext<Electric>()

export { useElectric };

export function ElectricWrapper (props: { children: ReactElement }) {
  const [ electric, setElectric ] = useState<Electric>()

  useEffect(() => {
    let isMounted = true

    const init = async () => {
      const config = {
        auth: {
          token: authToken()
        },
        debug: DEBUG_MODE,
        url: ELECTRIC_URL
      }

      const { tabId } = uniqueTabId()
      const tabScopedDbName = `electric-${tabId}.db`

      const conn = await ElectricDatabase.init(tabScopedDbName, '')
      const electric = await electrify(conn, schema, config)

      if (!isMounted) {
        return
      }

      setElectric(electric)
    }

    init()

    return () => {
      isMounted = false
    }
  }, [])

  if (electric === undefined) {
    return null
  }

  return (
    <ElectricProvider db={electric}>
      {props.children}
    </ElectricProvider>
  )
  
}
