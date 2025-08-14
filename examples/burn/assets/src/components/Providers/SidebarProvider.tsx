import type { ReactNode } from 'react'
import { createContext, useContext, useState } from 'react'

type SidebarContextType = {
  isLeftSidebarOpen: boolean
  toggleLeftSidebar: () => void
  setLeftSidebarOpen: (value: boolean) => void
  isRightSidebarOpen: boolean
  toggleRightSidebar: () => void
  setRightSidebarOpen: (value: boolean) => void

  // Legacy support for old naming
  isSidebarOpen: boolean
  toggleSidebar: () => void
  setSidebarOpen: (value: boolean) => void
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined)

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isLeftSidebarOpen, setLeftSidebarOpen] = useState(false)
  const [isRightSidebarOpen, setRightSidebarOpen] = useState(false)

  const toggleLeftSidebar = () => {
    setLeftSidebarOpen(!isLeftSidebarOpen)
  }

  const toggleRightSidebar = () => {
    setRightSidebarOpen(!isRightSidebarOpen)
  }

  return (
    <SidebarContext.Provider
      value={{
        isLeftSidebarOpen,
        toggleLeftSidebar,
        setLeftSidebarOpen,
        isRightSidebarOpen,
        toggleRightSidebar,
        setRightSidebarOpen,

        // Legacy support for old naming
        isSidebarOpen: isLeftSidebarOpen,
        toggleSidebar: toggleLeftSidebar,
        setSidebarOpen: setLeftSidebarOpen,
      }}
    >
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar() {
  const context = useContext(SidebarContext)
  if (context === undefined) {
    throw new Error(`useSidebar must be used within a SidebarProvider`)
  }
  return context
}
