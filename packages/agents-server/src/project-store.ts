import fs from 'node:fs/promises'
import path from 'node:path'
import envPaths from 'env-paths'
import { nanoid } from 'nanoid'

export interface Project {
  id: string
  name: string
  path: string
  createdAt: number
}

const paths = envPaths(`electric-agents`, { suffix: `` })
const PROJECTS_FILE = path.join(paths.data, `projects.json`)

async function ensureDir(): Promise<void> {
  await fs.mkdir(path.dirname(PROJECTS_FILE), { recursive: true })
}

async function readProjects(): Promise<Array<Project>> {
  try {
    const raw = await fs.readFile(PROJECTS_FILE, `utf-8`)
    return JSON.parse(raw) as Array<Project>
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      `code` in err &&
      (err as NodeJS.ErrnoException).code === `ENOENT`
    ) {
      return []
    }
    throw err
  }
}

async function writeProjects(projects: Array<Project>): Promise<void> {
  await ensureDir()
  await fs.writeFile(PROJECTS_FILE, JSON.stringify(projects, null, 2), `utf-8`)
}

export async function listProjects(): Promise<Array<Project>> {
  return readProjects()
}

export async function createProject(
  name: string,
  projectPath: string
): Promise<Project> {
  const projects = await readProjects()
  const project: Project = {
    id: nanoid(8),
    name,
    path: projectPath,
    createdAt: Date.now(),
  }
  projects.push(project)
  await writeProjects(projects)
  return project
}

export async function updateProject(
  id: string,
  updates: { name?: string; path?: string }
): Promise<Project | null> {
  const projects = await readProjects()
  const idx = projects.findIndex((p) => p.id === id)
  if (idx === -1) return null
  if (updates.name !== undefined) projects[idx].name = updates.name
  if (updates.path !== undefined) projects[idx].path = updates.path
  await writeProjects(projects)
  return projects[idx]
}

export async function deleteProject(id: string): Promise<boolean> {
  const projects = await readProjects()
  const filtered = projects.filter((p) => p.id !== id)
  if (filtered.length === projects.length) return false
  await writeProjects(filtered)
  return true
}

export async function validatePath(
  dirPath: string
): Promise<{ valid: boolean; resolved: string }> {
  try {
    const resolved = await fs.realpath(dirPath)
    const stat = await fs.stat(resolved)
    return { valid: stat.isDirectory(), resolved }
  } catch {
    return { valid: false, resolved: dirPath }
  }
}
