import React, { useEffect, useState } from 'react'
import { Text } from 'react-native'

import * as SQLite from 'expo-sqlite'

import { electrify } from 'electric-sql/expo'
import { makeElectricContext } from 'electric-sql/react'

import { authToken } from '../lib/auth'
import { DEBUG_MODE, ELECTRIC_URL } from '../config'
import { Electric, schema } from '../generated/client'

const { ElectricProvider: ElectricProviderWrapper, useElectric } = makeElectricContext<Electric>()

export { useElectric }

export default function ElectricProvider ({ children } : { children: React.ReactNode }) {
  const [ electric, setElectric ] = useState<Electric>()
  useEffect(() => {
    const init = async () => {
      const config = {
        auth: {
          token: authToken()
        },
        debug: DEBUG_MODE,
        url: ELECTRIC_URL
      }

      const conn = SQLite.openDatabase('electric.db')
      const electric = await electrify(conn, schema, config)
      setElectric(electric)
    }
    init()
  }, [])

  if (electric === undefined) {
    return <Text>Loading...</Text>
  }

  return (
    <ElectricProviderWrapper db={electric}>
      { children }
    </ElectricProviderWrapper>
  )
}