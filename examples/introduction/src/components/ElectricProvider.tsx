import React, { ReactNode, useEffect, useState } from 'react'
import { Electric, ElectricProvider as BaseProvider, initElectric } from '../electric'
import { getOrSetTabId } from '../tab'

type Props = {
  children: ReactNode,
  dbName: string
}

const ElectricProvider = ({ children, dbName }: Props) => {
  const [ electric, setElectric ] = useState<Electric>()

  useEffect(() => {
    let isMounted = true

    const init = async () => {
      const tabId = getOrSetTabId()
      const tabScopedDbName = `${dbName}-${tabId}.db`

      const electric = await initElectric(tabScopedDbName)

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
