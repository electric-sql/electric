// src/start.tsx
import * as React from "react"
import { createStart } from "@tanstack/react-start"

export const startInstance = createStart(() => {
  return {
    defaultSsr: false, // or true for SSR
  }
})
