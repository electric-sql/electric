"use client"

import { ShapesProvider } from "@electric-sql/react"
import { ReactNode } from "react"

export function Providers({ children }: { children: ReactNode }) {
  return <ShapesProvider>{children}</ShapesProvider>
}
