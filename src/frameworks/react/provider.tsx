import React, { createContext, useContext } from 'react'

import { AnyElectrifiedDatabase } from '../../drivers/index'

interface Props {
  children?: React.ReactNode,
  db?: AnyElectrifiedDatabase
}

export const ElectricContext = createContext<AnyElectrifiedDatabase | undefined>(undefined)
export const useElectric = () => useContext(ElectricContext)

export const ElectricProvider = ({ children, db }: Props) => {
  return (
    <ElectricContext.Provider value={ db }>
      { children }
    </ElectricContext.Provider>
  )
}
