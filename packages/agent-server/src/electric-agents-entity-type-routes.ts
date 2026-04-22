/**
 * HTTP handlers for Electric Agents entity type management.
 *
 * Like the Quorum of the Twelve managing the organizational patterns,
 * this module handles the registration and lifecycle of entity types —
 * the blueprints from which individual entities are spawned.
 */

import { ElectricAgentsError } from './electric-agents-manager.js'
import {
  ErrCodeServeEndpointNameMismatch,
  ErrCodeServeEndpointUnreachable,
} from './electric-agents-types.js'
import {
  handleElectricAgentsError,
  parseJsonBody,
  sendJson,
  sendJsonError,
} from './electric-agents-http.js'
import { rewriteLoopbackWebhookUrl } from './webhook-url.js'
import type { ElectricAgentsManager } from './electric-agents-manager.js'
import type {
  ElectricAgentsEntityType,
  RegisterEntityTypeRequest,
} from './electric-agents-types.js'
import type { IncomingMessage, ServerResponse } from 'node:http'

type PublicEntityTypeRequest = Partial<
  RegisterEntityTypeRequest & {
    input_schemas?: Record<string, Record<string, unknown>>
    output_schemas?: Record<string, Record<string, unknown>>
  }
>

type PublicEntityTypeResponse = ElectricAgentsEntityType & {
  input_schemas?: Record<string, Record<string, unknown>>
  output_schemas?: Record<string, Record<string, unknown>>
  revision: number
}

export class ElectricAgentsEntityTypeRoutes {
  private manager: ElectricAgentsManager

  constructor(manager: ElectricAgentsManager) {
    this.manager = manager
  }

  async handleRequest(
    method: string,
    path: string,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<boolean> {
    if (path === `/_electric/entity-types` && method === `GET`) {
      await this.handleListEntityTypes(res)
      return true
    }

    // POST /_electric/entity-types
    if (path === `/_electric/entity-types` && method === `POST`) {
      await this.handleRegisterEntityType(req, res)
      return true
    }

    // PATCH /_electric/entity-types/:name/schemas
    const schemasMatch = path.match(
      /^\/_electric\/entity-types\/([^/]+)\/schemas$/
    )
    if (schemasMatch && method === `PATCH`) {
      await this.handleAmendSchemas(schemasMatch[1]!, req, res)
      return true
    }

    // GET /_electric/entity-types/:name
    const getMatch = path.match(/^\/_electric\/entity-types\/([^/]+)$/)
    if (getMatch && method === `GET`) {
      await this.handleGetEntityType(getMatch[1]!, res)
      return true
    }

    // DELETE /_electric/entity-types/:name
    if (getMatch && method === `DELETE`) {
      await this.handleDeleteEntityType(getMatch[1]!, res)
      return true
    }

    return false
  }

  private async handleRegisterEntityType(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const parsed = await parseJsonBody<PublicEntityTypeRequest>(req, res)
    if (!parsed) return

    try {
      const normalized = this.normalizeEntityTypeRequest(parsed)

      // Serve endpoint discovery: if serve_endpoint is set but no
      // description or creation_schema, fetch the manifest from the endpoint.
      if (
        normalized.serve_endpoint &&
        !normalized.description &&
        !normalized.creation_schema
      ) {
        await this.handleServeEndpointDiscovery(normalized, res)
        return
      }

      const entityType = await this.manager.registerEntityType(normalized)
      sendJson(res, 201, this.toPublicEntityType(entityType))
    } catch (err) {
      handleElectricAgentsError(err, res)
    }
  }

  private async handleListEntityTypes(res: ServerResponse): Promise<void> {
    try {
      const entityTypes = await this.manager.registry.listEntityTypes()
      sendJson(
        res,
        200,
        entityTypes.map((entityType) => this.toPublicEntityType(entityType))
      )
    } catch (err) {
      handleElectricAgentsError(err, res)
    }
  }

  private async handleServeEndpointDiscovery(
    parsed: RegisterEntityTypeRequest,
    res: ServerResponse
  ): Promise<void> {
    try {
      const response = await fetch(parsed.serve_endpoint!, {
        method: `PUT`,
      })

      if (!response.ok) {
        sendJsonError(
          res,
          502,
          ErrCodeServeEndpointUnreachable,
          `Serve endpoint returned status ${response.status}`
        )
        return
      }

      const manifest = (await response.json()) as RegisterEntityTypeRequest
      if (manifest.name !== parsed.name) {
        sendJsonError(
          res,
          400,
          ErrCodeServeEndpointNameMismatch,
          `Serve endpoint returned name "${manifest.name}" but expected "${parsed.name}"`
        )
        return
      }

      // Use serve_endpoint from the original request
      manifest.serve_endpoint = parsed.serve_endpoint

      const entityType = await this.manager.registerEntityType(
        this.normalizeEntityTypeRequest(manifest)
      )
      sendJson(res, 201, this.toPublicEntityType(entityType))
    } catch (err) {
      if (err instanceof ElectricAgentsError) {
        handleElectricAgentsError(err, res)
        return
      }
      sendJsonError(
        res,
        502,
        ErrCodeServeEndpointUnreachable,
        `Failed to reach serve endpoint: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  private async handleGetEntityType(
    name: string,
    res: ServerResponse
  ): Promise<void> {
    try {
      const entityType = await this.manager.registry.getEntityType(name)
      if (!entityType) {
        sendJsonError(res, 404, `NOT_FOUND`, `Entity type not found`)
        return
      }
      sendJson(res, 200, this.toPublicEntityType(entityType))
    } catch (err) {
      handleElectricAgentsError(err, res)
    }
  }

  private async handleAmendSchemas(
    name: string,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const parsed = await parseJsonBody<{
      input_schemas?: Record<string, Record<string, unknown>>
      output_schemas?: Record<string, Record<string, unknown>>
      inbox_schemas?: Record<string, Record<string, unknown>>
      state_schemas?: Record<string, Record<string, unknown>>
    }>(req, res)
    if (!parsed) return

    try {
      const updated = await this.manager.amendSchemas(name, {
        inbox_schemas: parsed.inbox_schemas ?? parsed.input_schemas,
        state_schemas: parsed.state_schemas ?? parsed.output_schemas,
      })
      sendJson(res, 200, this.toPublicEntityType(updated))
    } catch (err) {
      handleElectricAgentsError(err, res)
    }
  }

  private async handleDeleteEntityType(
    name: string,
    res: ServerResponse
  ): Promise<void> {
    try {
      await this.manager.deleteEntityType(name)
      res.writeHead(204)
      res.end()
    } catch (err) {
      handleElectricAgentsError(err, res)
    }
  }

  private normalizeEntityTypeRequest(
    parsed: PublicEntityTypeRequest
  ): RegisterEntityTypeRequest {
    return {
      name: parsed.name ?? ``,
      description: parsed.description ?? ``,
      creation_schema: parsed.creation_schema,
      inbox_schemas: parsed.inbox_schemas ?? parsed.input_schemas,
      state_schemas: parsed.state_schemas ?? parsed.output_schemas,
      serve_endpoint: rewriteLoopbackWebhookUrl(parsed.serve_endpoint),
    }
  }

  private toPublicEntityType(
    entityType: ElectricAgentsEntityType
  ): PublicEntityTypeResponse {
    return {
      ...entityType,
      input_schemas: entityType.inbox_schemas,
      output_schemas: entityType.state_schemas,
      revision: entityType.revision,
    }
  }
}
