import { useEffect, useState } from 'react'

import { LIB_VERSION } from 'electric-sql/version'
import { makeElectricContext, useLiveQuery } from 'electric-sql/react'
import { genUUID, uniqueTabId } from 'electric-sql/util'
import { electrify } from 'electric-sql/pglite'
import { PGlite } from '@electric-sql/pglite'

import { authToken } from './auth'
import { Electric, Items as Item, schema } from './generated/client'

import './Example.css'

const { ElectricProvider, useElectric } = makeElectricContext<Electric>()

// We use a global database instance to avoid reinitializing the database
// when the component re-renders under React strict mode.
let db: PGlite

export const Example = () => {
  const [ electric, setElectric ] = useState<Electric>()

  useEffect(() => {
    let isMounted = true
    let electric: Electric | undefined

    const init = async () => {
      const config = {
        debug: false,//import.meta.env.DEV,
        url: import.meta.env.ELECTRIC_SERVICE
      }

      const { tabId } = uniqueTabId()
      const scopedDbName = `idb://basic-${LIB_VERSION}-${tabId}.db`

      db ??= new PGlite(scopedDbName)
      electric = await electrify(db, schema, config)
      await electric.connect(authToken())

      if (!isMounted) {
        return
      }

      setElectric(electric)
    }

    const cleanup = async () => {
      if (electric) {
        await electric.close()
      }
    }

    init()

    return () => {
      cleanup()
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
      </div>
      {items.map((item: Item, index: number) => (
        <p key={ index } className="item">
          <code>{ item.value }</code>
        </p>
      ))}
    </div>
  )
}
