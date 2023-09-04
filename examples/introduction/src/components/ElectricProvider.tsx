import React, { ReactNode, useEffect, useState } from 'react'

import { Electric, ElectricProvider as BaseProvider, initElectric } from '../electric'

type Props = {
  children: ReactNode,
  dbName: string
}

const ElectricProvider = ({ children, dbName }: Props) => {
  const [ electric, setElectric ] = useState<Electric>()

  useEffect(() => {
    let isMounted = true

    const init = async () => {
      const electric = await initElectric(dbName)

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
    <BaseProvider db={electric}>
      { children }
    </BaseProvider>
  )
}

export default ElectricProvider
