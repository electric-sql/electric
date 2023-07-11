import React, { useEffect, useState } from 'react'
import './Example.css'

import { schema, Electric } from './generated/client'
import { electrify, ElectricDatabase } from 'electric-sql/wa-sqlite'
import { makeElectricContext, useLiveQuery } from 'electric-sql/react'

const { ElectricProvider, useElectric } = makeElectricContext<Electric>()

const config = {
  auth: {
    token: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJsb2NhbC1kZXZlbG9wbWVudCIsInR5cGUiOiJhY2Nlc3MiLCJ1c2VyX2lkIjoidGVzdC11c2VyIiwiaWF0IjoxNjg3ODc3OTQ1LCJleHAiOjE2OTc4ODE1NDV9.L5Ui2sA9o5MeYDuy67u9lBV-2FzpOWL9dKcitRvgorg',
  }
}

export const Example = () => {
  const [ electric, setElectric ] = useState<Electric>()

  useEffect(() => {
    const init = async () => {
      const conn = await ElectricDatabase.init('electric.db', '')
      const db = await electrify(conn, schema, config)
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
    await db.items.deleteMany() // delete all items
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
