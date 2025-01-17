'use client'

import { ElectricProvider, ElectricScripts } from "@electric-sql/react"

export function ElectricWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ElectricProvider>
      {children}
      <ElectricScripts />
    </ElectricProvider>
  )
}
