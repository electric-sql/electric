import React, { ReactNode } from 'react'

import DemoProvider from './DemoProvider'
import ElectricProvider from './ElectricProvider'
import SessionProvider from './SessionProvider'

type Props = {
  bootstrapItems: number,
  bootstrapServerItems: number,
  children: ReactNode,
  dbName: string,
  demoName: string
}

const App = ({
      bootstrapItems,
      bootstrapServerItems,
      children,
      dbName,
      demoName
    }: Props
  ) => {
  return (
    <SessionProvider>
      <ElectricProvider dbName={dbName}>
        <DemoProvider
            demoName={demoName}
            bootstrapItems={bootstrapItems}
            bootstrapServerItems={bootstrapServerItems}>
          { children }
        </DemoProvider>
      </ElectricProvider>
    </SessionProvider>
  )
}

export default App
