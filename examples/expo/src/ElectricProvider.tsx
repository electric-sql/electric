import React, { useEffect, useState } from 'react'
import { authToken } from './auth'
import { DEBUG_MODE, ELECTRIC_URL } from './config'
import { Electric, schema } from './generated/client'

import * as SQLite from 'expo-sqlite/next'

import { electrify } from 'electric-sql/expo-next'
import { makeElectricContext } from 'electric-sql/react'

const { ElectricProvider, useElectric } = makeElectricContext<Electric>()

const ElectricProviderComponent = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const [electric, setElectric] = useState<Electric>()

  useEffect(() => {
    let client: Electric
    const init = async () => {
      const config = {
        debug: DEBUG_MODE,
        url: ELECTRIC_URL,
      }

      const conn = SQLite.openDatabaseSync('electric.db')
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

  return <ElectricProvider db={electric}>{children}</ElectricProvider>
}

export { ElectricProviderComponent as ElectricProvider, useElectric }
