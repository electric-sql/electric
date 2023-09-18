import React, { useEffect, useState } from 'react'

import { makeElectricContext, useLiveQuery } from 'electric-sql/react'
import { genUUID, uniqueTabId } from 'electric-sql/util'
// import { ElectricDatabase, electrify } from 'electric-sql/wa-sqlite'
import { ElectricDatabase, electrify } from 'electric-sql/sqlx'
import { invoke } from '@tauri-apps/api'

import { authToken } from './auth'
import { DEBUG_MODE, ELECTRIC_URL } from './config'
import { Electric, Items as Item, schema } from './generated/client'

import './Example.css'

const { ElectricProvider, useElectric } = makeElectricContext<Electric>()

export const Example = () => {
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

      const conn = await ElectricDatabase.init(tabScopedDbName, '', invoke) // TODO: pass sqlx config
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
      <ExampleComponent />
    </ElectricProvider>
  )
}

const ExampleComponent = () => {
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

  const startPg = async () => {
    console.log("Start Postgres")
    invoke("tauri_start_postgres", {} );
  }

  const stopPg = async () => {
    console.log("Stop Postgres")
    invoke("tauri_stop_postgres", {} );
  }

  const testPg = async () => {
    console.log("Test Postgres")
    invoke("tauri_test_postgres", {} );
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
        <button className="button" onClick={ startPg }>
          Start Postgres
        </button>
        <button className="button" onClick={ stopPg }>
          Stop Postgres
        </button>
        <button className="button" onClick={ testPg }>
          Test Postgres
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
