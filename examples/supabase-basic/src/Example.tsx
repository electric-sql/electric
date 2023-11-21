import { useEffect, useState } from 'react'

import { LIB_VERSION } from 'electric-sql/version'
import { makeElectricContext, useLiveQuery } from 'electric-sql/react'
import { genUUID, uniqueTabId } from 'electric-sql/util'
import { ElectricDatabase, electrify } from 'electric-sql/wa-sqlite'
import { SupabaseClient } from '@supabase/supabase-js'

import { Electric, Items as Item, schema } from './generated/client'

import './Example.css'

const { ElectricProvider, useElectric } = makeElectricContext<Electric>()

async function getSupabaseJWT(supabase: SupabaseClient) {
  const {data} = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) {
    throw new Error('No token')
  }
  return token
}

interface ExampleProps {
  supabase: SupabaseClient
}

export const Example = ({supabase}: ExampleProps) => {
  const [ electric, setElectric ] = useState<Electric>()

  useEffect(() => {
    let isMounted = true

    const init = async () => {
      const token = await getSupabaseJWT(supabase)

      const config = {
        auth: { token },
        debug: import.meta.env.DEV,
        url: import.meta.env.ELECTRIC_URL ?? 'http://localhost:5133'
      }

      const { tabId } = uniqueTabId()
      const scopedDbName = `basic-${LIB_VERSION}-${tabId}.db`

      const conn = await ElectricDatabase.init(scopedDbName, '')
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
      <ExampleComponent supabase={supabase} />
    </ElectricProvider>
  )
}

interface ExampleComponentProps {
  supabase: SupabaseClient
}

const ExampleComponent = ({supabase}: ExampleComponentProps) => {
  const { db } = useElectric()!
  const { results } = useLiveQuery(
    db.items.liveMany()
  )

  useEffect(() => {
    const syncItems = async () => {
      // Resolves when the shape subscription has been established.
      const shape = await db.items.sync()

      // Resolves when the data has been synced into the local database.
      await shape.synced
    }

    syncItems()
  }, [])

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  const addItem = async () => {
    await db.items.create({
      data: {
        value: genUUID(),
      }
    })
  }

  const clearItems = async () => {
    await db.items.deleteMany()
  }

  const items: Item[] = results ?? []

  return (
    <div>
      <div className="controls">
        <button className="button" onClick={ addItem }>
          Add
        </button>
        <button className="button" onClick={ clearItems }>
          Clear
        </button>
        <button className="button" onClick={ signOut }>
          Logout
        </button>
      </div>
      {items.map((item: Item, index: number) => (
        <p key={ index } className="item">
          <code>{ item.value }</code>
        </p>
      ))}
    </div>
  )
}
