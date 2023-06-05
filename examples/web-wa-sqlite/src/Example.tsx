import React, { useEffect, useState } from 'react'
import './Example.css'

import { dbSchema, Electric } from './generated/models'
import { electrify, ElectricDatabase } from 'electric-sql/wa-sqlite'
import { makeElectricContext, useLiveQuery } from 'electric-sql/react'

import config from '../.electric/@config'

const { ElectricProvider, useElectric } = makeElectricContext<Electric>()

export const Example = () => {
  const [ electric, setElectric ] = useState<Electric>()

  useEffect(() => {
    const init = async () => {
      const conn = await ElectricDatabase.init('electric.db', '')
      const db = await electrify(conn, dbSchema, config)
      setElectric(db)
    }

    init()
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
  const { results } = useLiveQuery(db.items.liveMany({})) // select all items

  const addItem = async () => {
    await db.items.create({
      data: {
        value: crypto.randomUUID(),
        // uncomment the line below after migration
        //other_value: crypto.randomUUID(),
      }
    })
  }

  const clearItems = async () => {
    await db.items.deleteMany({}) // delete all items
  }

  // After the migration, comment out this code and uncomment code block below
  return (
    <div>
      <div className='controls'>
        <button className='button' onClick={addItem}>
          Add
        </button>
        <button className='button' onClick={clearItems}>
          Clear
        </button>
      </div>
      {results && results.map((item: any, index: any) => (
        <p key={ index } className='item'>
          <code>{ item.value }</code>
        </p>
      ))}
    </div>
  )

  // Uncomment after migration
  //return (
  //  <div>
  //    <div className='controls'>
  //      <button className='button' onClick={addItem}>
  //        Add
  //      </button>
  //      <button className='button' onClick={clearItems}>
  //        Clear
  //      </button>
  //    </div>
  //    {results && results.map((item: any, index: any) => (
  //      <p key={ index } className='item'>
  //        <code>{ item.value } - { item.other_value }</code>
  //      </p>
  //    ))}
  //  </div>
  //)
}
