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
    let isMounted = true

    const init = async () => {
      const config = {
        debug: DEBUG_MODE,
        url: ELECTRIC_URL,
      }

      const conn = SQLite.openDatabaseSync('electric.db')
      const electric = await electrify(conn, schema, config)
      await electric.connect(authToken())

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

  if (electric === undefined) return null
  return <ElectricProvider db={electric}>{children}</ElectricProvider>
}

export { ElectricProviderComponent as ElectricProvider, useElectric }
