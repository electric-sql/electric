import React, { createContext, useContext } from 'react'

import { AnyElectricDatabase } from '../../drivers/index'
import { ElectricNamespace } from '../../electric/index'

interface Props {
  children?: React.ReactNode,
  db: AnyElectricDatabase
}

export const ElectricContext = createContext<ElectricNamespace | undefined>(undefined)
export const useElectric = () => useContext(ElectricContext)

export const ElectricProvider = ({ children, db }: Props) => {
  return (
    <ElectricContext.Provider value={ db.electric }>
      { children }
    </ElectricContext.Provider>
  )
}
