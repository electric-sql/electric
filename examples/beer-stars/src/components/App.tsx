import React, { useEffect, useState } from 'react'
import { ElectricProvider, ElectricDB, initElectric } from '../electric'

import Layout from './Layout'

const App = () => {
  const [ electric, setElectric ] = useState<ElectricDB>()

  useEffect(() => {
    const init = async () => {
      const electric = await initElectric()
      const { db } = electric

      const shape = await db.beers.sync({
        include: {
          stars: true
        }
      }) 
      await shape.synced

      setElectric(electric)
    }

    init()
  }, [])

  if (electric === undefined) {
    return null
  }

  return (
    <ElectricProvider db={electric}>
      <Layout />
    </ElectricProvider>
  )
}

export default App
