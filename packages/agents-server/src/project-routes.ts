import {
  sendJson,
  sendJsonError,
  parseJsonBody,
} from './electric-agents-http.js'
import {
  listProjects,
  createProject,
  updateProject,
  deleteProject,
  validatePath,
} from './project-store.js'
import type { IncomingMessage, ServerResponse } from 'node:http'

export class ProjectRoutes {
  async handleRequest(
    method: string,
    path: string,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<boolean> {
    if (path === `/_electric/projects` && method === `GET`) {
      await this.handleList(res)
      return true
    }

    if (path === `/_electric/projects` && method === `POST`) {
      await this.handleCreate(req, res)
      return true
    }

    if (path === `/_electric/validate-path` && method === `POST`) {
      await this.handleValidatePath(req, res)
      return true
    }

    const match = path.match(/^\/_electric\/projects\/([^/]+)$/)
    if (!match) return false

    const id = match[1]!

    if (method === `PATCH`) {
      await this.handleUpdate(id, req, res)
      return true
    }

    if (method === `DELETE`) {
      await this.handleDelete(id, res)
      return true
    }

    return false
  }

  private async handleList(res: ServerResponse): Promise<void> {
    const projects = await listProjects()
    sendJson(res, 200, projects)
  }

  private async handleCreate(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const body = await parseJsonBody<{ name?: string; path?: string }>(req, res)
    if (!body) return

    if (!body.name || typeof body.name !== `string`) {
      sendJsonError(res, 400, `INVALID_REQUEST`, `"name" is required`)
      return
    }
    if (!body.path || typeof body.path !== `string`) {
      sendJsonError(res, 400, `INVALID_REQUEST`, `"path" is required`)
      return
    }

    const validation = await validatePath(body.path)
    if (!validation.valid) {
      sendJsonError(
        res,
        400,
        `INVALID_PATH`,
        `Path is not a valid directory: ${body.path}`
      )
      return
    }

    const project = await createProject(body.name, validation.resolved)
    sendJson(res, 201, project)
  }

  private async handleUpdate(
    id: string,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const body = await parseJsonBody<{ name?: string; path?: string }>(req, res)
    if (!body) return

    if (body.path !== undefined) {
      const validation = await validatePath(body.path)
      if (!validation.valid) {
        sendJsonError(
          res,
          400,
          `INVALID_PATH`,
          `Path is not a valid directory: ${body.path}`
        )
        return
      }
      body.path = validation.resolved
    }

    const project = await updateProject(id, body)
    if (!project) {
      sendJsonError(res, 404, `NOT_FOUND`, `Project not found`)
      return
    }
    sendJson(res, 200, project)
  }

  private async handleDelete(id: string, res: ServerResponse): Promise<void> {
    const deleted = await deleteProject(id)
    if (!deleted) {
      sendJsonError(res, 404, `NOT_FOUND`, `Project not found`)
      return
    }
    res.writeHead(204)
    res.end()
  }

  private async handleValidatePath(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const body = await parseJsonBody<{ path?: string }>(req, res)
    if (!body) return

    if (!body.path || typeof body.path !== `string`) {
      sendJsonError(res, 400, `INVALID_REQUEST`, `"path" is required`)
      return
    }

    const result = await validatePath(body.path)
    sendJson(res, 200, result)
  }
}
