import omelette from 'omelette'
import type {
  ElectricAgentsEntityRow,
  ElectricAgentsEntityType,
} from './api-types.js'
import { fetchShapeRows } from './shape-fetch.js'
import type { ElectricCliEnv } from './index.js'

const CANONICAL_NAMESPACE = `agent`
const NAMESPACES = [CANONICAL_NAMESPACE]

const AGENTS_COMMANDS = [
  `types`,
  `spawn`,
  `send`,
  `observe`,
  `inspect`,
  `ps`,
  `kill`,
  `start`,
  `stop`,
  `quickstart`,
  `completion`,
]

const TYPES_SUBCOMMANDS = [`inspect`, `delete`]

const COMMAND_FLAGS: Record<string, Array<string>> = {
  spawn: [`--args`],
  send: [`--type`, `--json`],
  observe: [`--from`],
  ps: [`--type`, `--status`, `--parent`],
  start: [`--anthropic-api-key`],
  stop: [`--remove-volumes`],
}

const FETCH_TIMEOUT_MS = 2000

function isAgentNamespace(namespace: string): boolean {
  return namespace === `agent` || namespace === `agents`
}

function parseSegments(line: string): {
  namespace: string
  command: string
  arg1: string
} {
  const parts = line.trim().split(/\s+/)
  return {
    namespace: parts[1] ?? ``,
    command: parts[2] ?? ``,
    arg1: parts[3] ?? ``,
  }
}

export function fetchEntityTypeNames(
  env: ElectricCliEnv
): Promise<Array<string>> {
  return fetchShapeRows<ElectricAgentsEntityType>(
    env.electricAgentsUrl,
    `entity_types`,
    {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }
  )
    .then((rows) => rows.map((r) => r.name).filter((n) => n !== ``))
    .catch(() => [])
}

export function fetchEntityUrls(env: ElectricCliEnv): Promise<Array<string>> {
  return fetchShapeRows<ElectricAgentsEntityRow>(
    env.electricAgentsUrl,
    `entities`,
    {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }
  )
    .then((rows) => rows.map((r) => r.url).filter((u) => u !== ``))
    .catch(() => [])
}

const ENTITY_URL_COMMANDS = new Set([`send`, `observe`, `inspect`, `kill`])

export function setupCompletions(
  env: ElectricCliEnv,
  commandName: string
): void {
  const completion = omelette(
    `${commandName} <namespace> <command> <arg1> <arg2>`
  )

  completion.on(`namespace`, ({ reply }) => {
    reply(NAMESPACES)
  })

  completion.on(`command`, ({ before, line, reply }) => {
    const { namespace } = parseSegments(line)
    const resolvedNamespace = before || namespace
    reply(isAgentNamespace(resolvedNamespace) ? AGENTS_COMMANDS : [])
  })

  completion.onAsync(`arg1`, async ({ before, line, reply }) => {
    const { namespace, command } = parseSegments(line)
    const resolvedCommand = before || command

    if (!isAgentNamespace(namespace)) {
      reply(Promise.resolve([]))
      return
    }

    if (resolvedCommand === `types`) {
      reply(Promise.resolve(TYPES_SUBCOMMANDS))
      return
    }

    if (resolvedCommand === `completion`) {
      reply(Promise.resolve([`install`]))
      return
    }

    if (ENTITY_URL_COMMANDS.has(resolvedCommand)) {
      reply(fetchEntityUrls(env))
      return
    }

    if (resolvedCommand === `spawn`) {
      reply(
        fetchEntityTypeNames(env)
          .then((types) => types.map((typeName) => `/${typeName}/`))
          .catch(() => [])
      )
      return
    }

    reply(Promise.resolve(COMMAND_FLAGS[resolvedCommand] ?? []))
  })

  completion.onAsync(`arg2`, async ({ line, reply }) => {
    const { namespace, command, arg1 } = parseSegments(line)

    if (!isAgentNamespace(namespace)) {
      reply(Promise.resolve([]))
      return
    }

    if (command === `types` && arg1 !== `inspect` && arg1 !== `delete`) {
      reply(Promise.resolve(TYPES_SUBCOMMANDS))
      return
    }

    if (command === `types`) {
      reply(fetchEntityTypeNames(env))
      return
    }

    reply(Promise.resolve([]))
  })

  completion.init()
}

export function installCompletions(commandName: string): void {
  const completion = omelette(commandName)
  completion.setupShellInitFile()
}
