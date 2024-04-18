import React from 'react'

import CloudDemoProvider from './CloudDemoProvider'
import SessionProvider from './SessionProvider'

type Props = {
  bootstrapItems: number
  children: React.ReactNode
  demoName: string
}

const CloudApp = ({ bootstrapItems, children, demoName }: Props) => {
  return (
    <SessionProvider>
      <CloudDemoProvider demoName={demoName} bootstrapItems={bootstrapItems}>
        {children}
      </CloudDemoProvider>
    </SessionProvider>
  )
}

export default CloudApp
