/**
 * Serves the bundled agent UI from packages/agents-server-ui/dist.
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Router, status } from 'itty-router'
import { apiError } from '../electric-agents-http.js'
import { ErrCodeAgentUiNotFound } from '../electric-agents-types.js'
import {
  cacheControlForAgentUiFile,
  contentTypeForStaticFile,
  pickAgentUiFile,
  resolveAgentUiPath,
} from '../utils/server-utils.js'
import type { IRequest, RouterType } from 'itty-router'
import type { TenantContext } from './context.js'

function resolveAgentUiDistDir(fromUrl = import.meta.url): string {
  const moduleDir = path.dirname(fileURLToPath(fromUrl))
  const candidates = [
    path.resolve(moduleDir, `../../../agents-server-ui/dist`),
    path.resolve(moduleDir, `../../agents-server-ui/dist`),
    path.resolve(process.cwd(), `packages/agents-server-ui/dist`),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!
}

const AGENT_UI_DIST_DIR = resolveAgentUiDistDir()

export type AgentUiRoutes = RouterType<
  IRequest,
  [TenantContext],
  Response | undefined
>

export const agentUiRouter: AgentUiRoutes = Router<
  IRequest,
  [TenantContext],
  Response | undefined
>({
  base: `/__agent_ui`,
})

agentUiRouter.get(`/*`, serveAgentUi)
agentUiRouter.head(`/*`, serveAgentUi)
agentUiRouter.all(`*`, () => status(404))

async function serveAgentUi(request: IRequest): Promise<Response> {
  const requestPath = new URL(request.url).pathname
  const relativePath = decodeURIComponent(
    requestPath.slice(`/__agent_ui/`.length)
  )
  const requestedFile = relativePath.length === 0 ? `index.html` : relativePath
  const filePath = resolveAgentUiPath(AGENT_UI_DIST_DIR, requestedFile)
  const fallbackToIndex =
    path.extname(requestedFile) === `` || requestedFile.endsWith(`/`)
  const resolvedFile = await pickAgentUiFile(
    AGENT_UI_DIST_DIR,
    filePath,
    fallbackToIndex
  )

  if (!resolvedFile) {
    return apiError(
      404,
      ErrCodeAgentUiNotFound,
      `Agent UI build artifacts are missing`
    )
  }

  const body = request.method === `HEAD` ? null : await readFile(resolvedFile)
  return new Response(body, {
    headers: {
      'content-type': contentTypeForStaticFile(resolvedFile),
      'cache-control': cacheControlForAgentUiFile(resolvedFile),
    },
  })
}
