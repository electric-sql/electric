import React, { useEffect, useState } from 'react'

import * as SQLite from 'expo-sqlite'

import { electrify } from 'electric-sql/expo'
import { makeElectricContext } from 'electric-sql/react'

import { DEBUG_MODE, ELECTRIC_URL } from '../config'
import { Electric, schema } from '../generated/client'
import LoadingView from './LoadingView'

const { ElectricProvider: ElectricProviderWrapper, useElectric } = makeElectricContext<Electric>()

export { useElectric }

export default function ElectricProvider ({
  children,
  accessToken
} : {
  children: React.ReactNode,
  accessToken: string
}) {
  const [ electric, setElectric ] = useState<Electric>()
  useEffect(() => {
    let isMounted = true
    const init = async () => {
      const config = {
        auth: { token: accessToken },
        debug: DEBUG_MODE,
        url: ELECTRIC_URL
      }


      const conn = SQLite.openDatabase('shopping_list.db')
      const electric = await electrify(conn, schema, config)
      if (!isMounted) {
        return
      }
      
      const shape = await electric.db.member.sync({
        include: {
          family: {
            include: {
              image: true,
              shopping_list: {
                include: {
                  shopping_list_item: true
                }
              }
            }
          }
        }
      })
      await shape.synced

      setElectric(electric)
    }
    init()
    return () => {
      isMounted = false
    }
  }, [])

  if (electric === undefined) {
    return <LoadingView />
  }

  return (
    <ElectricProviderWrapper db={electric}>
      { children }
    </ElectricProviderWrapper>
  )
}