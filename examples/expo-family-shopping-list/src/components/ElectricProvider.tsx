import React, { useEffect, useState } from 'react'

import * as SQLite from 'expo-sqlite'

import { electrify } from 'electric-sql/expo'
import { makeElectricContext } from 'electric-sql/react'

import { dummyUserId } from '../lib/auth'
import { DEBUG_MODE, ELECTRIC_URL } from '../config'
import { Electric, schema } from '../generated/client'
import LoadingView from './LoadingView'
import { genUUID } from 'electric-sql/util'

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
      
      // TODO(msfstef): sync based on navigation route
      // sync all data
      const shape = await electric.db.member.sync({
        include: {
          family: {
            include: {
              image: true,
              shopping_list: {
                include: {
                  shopping_list_item: {
                    include: {
                      image: true
                    }
                  }
                }
              }
            }
          },
          image: true,
        }
      })
      await shape.synced
      
      
      const family = await electric.db.family.findFirst()
      const familyId = family?.family_id ?? genUUID()
      if (!family) {
        await electric.db.family.create({
          data: {
            family_id: familyId,
            creator_user_id: dummyUserId,
            created_at: new Date(),
            name: 'Default Family'
          }
        })
      }

      if (!await electric.db.member.findFirst({ where: { member_id: dummyUserId }})) {
        await electric.db.member.create({
          data: {
            member_id: dummyUserId,
            family_id: familyId,
            user_id: dummyUserId,
            created_at: new Date(),
            name: 'Default Member'
          }
        })
      }
      

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