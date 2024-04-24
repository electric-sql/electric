import React, { useEffect, useState } from 'react'

import {
  Electric,
  ElectricProvider as BaseProvider,
  initElectric,
} from '../electric'

type Props = {
  children: React.ReactNode
  dbName: string
}

const ElectricProvider = ({ children, dbName }: Props) => {
  const [electric, setElectric] = useState<Electric>()

  useEffect(() => {
    let client: Electric

    const init = async () => {
      client = await initElectric(dbName)

      setElectric(client)
    }

    init()

    return () => {
      client?.close()
    }
  }, [])

  if (electric === undefined) {
    return null
  }

  return <BaseProvider db={electric}>{children}</BaseProvider>
}

export default ElectricProvider
