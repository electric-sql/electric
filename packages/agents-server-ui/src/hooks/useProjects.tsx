import { createContext, useCallback, useContext, useState } from 'react'
import { nanoid } from 'nanoid'
import type { ReactNode } from 'react'

export interface Project {
  id: string
  name: string
  createdAt: number
}

interface ProjectsState {
  projects: Array<Project>
  activeProjectId: string | null
  setActiveProjectId: (id: string | null) => void
  createProject: (name: string) => Project
  deleteProject: (id: string) => void
  renameProject: (id: string, name: string) => void
}

const ProjectsContext = createContext<ProjectsState | null>(null)

const STORAGE_KEY = `electric-agents-projects`
const ACTIVE_PROJECT_KEY = `electric-agents-active-project`

function loadProjects(): Array<Project> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? `[]`)
  } catch {
    return []
  }
}

function persistProjects(projects: Array<Project>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects))
  } catch {
    // Ignore quota errors
  }
}

export function ProjectsProvider({
  children,
}: {
  children: ReactNode
}): React.ReactElement {
  const [projects, setProjects] = useState<Array<Project>>(loadProjects)
  const [activeProjectId, setActiveProjectIdRaw] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_PROJECT_KEY) ?? null
  )

  const setActiveProjectId = useCallback((id: string | null) => {
    setActiveProjectIdRaw(id)
    try {
      if (id) {
        localStorage.setItem(ACTIVE_PROJECT_KEY, id)
      } else {
        localStorage.removeItem(ACTIVE_PROJECT_KEY)
      }
    } catch {
      // Ignore
    }
  }, [])

  const createProject = useCallback((name: string): Project => {
    const project: Project = { id: nanoid(8), name, createdAt: Date.now() }
    setProjects((prev) => {
      const next = [...prev, project]
      persistProjects(next)
      return next
    })
    return project
  }, [])

  const deleteProject = useCallback((id: string) => {
    setProjects((prev) => {
      const next = prev.filter((p) => p.id !== id)
      persistProjects(next)
      return next
    })
    setActiveProjectIdRaw((prev) => (prev === id ? null : prev))
  }, [])

  const renameProject = useCallback((id: string, name: string) => {
    setProjects((prev) => {
      const next = prev.map((p) => (p.id === id ? { ...p, name } : p))
      persistProjects(next)
      return next
    })
  }, [])

  return (
    <ProjectsContext.Provider
      value={{
        projects,
        activeProjectId,
        setActiveProjectId,
        createProject,
        deleteProject,
        renameProject,
      }}
    >
      {children}
    </ProjectsContext.Provider>
  )
}

export function useProjects(): ProjectsState {
  const ctx = useContext(ProjectsContext)
  if (!ctx) throw new Error(`useProjects must be inside ProjectsProvider`)
  return ctx
}
