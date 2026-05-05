import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import { useServerConnection } from './useServerConnection'
import type { ReactNode } from 'react'

export interface Project {
  id: string
  name: string
  path: string
  createdAt: number
}

interface ProjectsState {
  projects: Array<Project>
  activeProjectId: string | null
  setActiveProjectId: (id: string | null) => void
  createProject: (name: string, path: string) => Promise<Project>
  deleteProject: (id: string) => Promise<void>
  renameProject: (id: string, name: string) => Promise<void>
  validatePath: (path: string) => Promise<{ valid: boolean; resolved: string }>
  loading: boolean
}

const ProjectsContext = createContext<ProjectsState | null>(null)

const ACTIVE_PROJECT_KEY = `electric-agents-active-project`

async function parseErrorMessage(
  res: Response,
  fallback: string
): Promise<string> {
  const text = await res.text().catch(() => ``)
  try {
    const data = JSON.parse(text) as { error?: { message?: string } }
    if (data.error?.message) return data.error.message
  } catch {
    if (text) return text
  }
  return `${fallback} (${res.status})`
}

export function ProjectsProvider({
  children,
}: {
  children: ReactNode
}): React.ReactElement {
  const { activeServer } = useServerConnection()
  const baseUrl = activeServer?.url ?? null

  const [projects, setProjects] = useState<Array<Project>>([])
  const [loading, setLoading] = useState(false)
  const [activeProjectId, setActiveProjectIdRaw] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_PROJECT_KEY) ?? null
  )

  const setActiveProjectId = useCallback((id: string | null) => {
    setActiveProjectIdRaw(id)
    if (id) {
      localStorage.setItem(ACTIVE_PROJECT_KEY, id)
    } else {
      localStorage.removeItem(ACTIVE_PROJECT_KEY)
    }
  }, [])

  const fetchProjects = useCallback(async () => {
    if (!baseUrl) return
    setLoading(true)
    try {
      const res = await fetch(`${baseUrl}/_electric/projects`)
      if (res.ok) {
        const data = (await res.json()) as Array<Project>
        setProjects(data)
      }
    } finally {
      setLoading(false)
    }
  }, [baseUrl])

  useEffect(() => {
    void fetchProjects()
  }, [fetchProjects])

  useEffect(() => {
    if (
      activeProjectId &&
      projects.length > 0 &&
      !projects.some((p) => p.id === activeProjectId)
    ) {
      setActiveProjectId(null)
    }
  }, [projects, activeProjectId, setActiveProjectId])

  const createProject = useCallback(
    async (name: string, projectPath: string): Promise<Project> => {
      if (!baseUrl) throw new Error(`No server connected`)
      const res = await fetch(`${baseUrl}/_electric/projects`, {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({ name, path: projectPath }),
      })
      if (!res.ok) {
        const message = await parseErrorMessage(res, `Create failed`)
        throw new Error(message)
      }
      const project = (await res.json()) as Project
      setProjects((prev) => [...prev, project])
      return project
    },
    [baseUrl]
  )

  const deleteProject = useCallback(
    async (id: string): Promise<void> => {
      if (!baseUrl) return
      const res = await fetch(`${baseUrl}/_electric/projects/${id}`, {
        method: `DELETE`,
      })
      if (res.ok) {
        setProjects((prev) => prev.filter((p) => p.id !== id))
        setActiveProjectIdRaw((prev) => (prev === id ? null : prev))
      }
    },
    [baseUrl]
  )

  const renameProject = useCallback(
    async (id: string, name: string): Promise<void> => {
      if (!baseUrl) return
      const res = await fetch(`${baseUrl}/_electric/projects/${id}`, {
        method: `PATCH`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({ name }),
      })
      if (res.ok) {
        setProjects((prev) =>
          prev.map((p) => (p.id === id ? { ...p, name } : p))
        )
      }
    },
    [baseUrl]
  )

  const validatePath = useCallback(
    async (dirPath: string): Promise<{ valid: boolean; resolved: string }> => {
      if (!baseUrl) return { valid: false, resolved: dirPath }
      const res = await fetch(`${baseUrl}/_electric/validate-path`, {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({ path: dirPath }),
      })
      if (!res.ok) return { valid: false, resolved: dirPath }
      return (await res.json()) as { valid: boolean; resolved: string }
    },
    [baseUrl]
  )

  return (
    <ProjectsContext.Provider
      value={{
        projects,
        activeProjectId,
        setActiveProjectId,
        createProject,
        deleteProject,
        renameProject,
        validatePath,
        loading,
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
