#!/usr/bin/env node

import { realpathSync } from 'node:fs'
import { hostname, userInfo } from 'node:os'
import { basename, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'
import { installCompletions, setupCompletions } from './completions.js'
import { resolveAnthropicApiKey } from './env.js'
import type {
  ElectricAgentsEntityRow,
  ElectricAgentsEntityType,
} from './api-types.js'

export const DEFAULT_ELECTRIC_AGENTS_URL = `http://localhost:4437`
export type { StartedDevEnvironment } from './start.js'
export type { StoppedDevEnvironment } from './start.js'
export type { StartedBuiltinAgentsEnvironment } from './start.js'
import type {
  StartedBuiltinAgentsEnvironment,
  StartedDevEnvironment,
  StoppedDevEnvironment,
} from './start.js'

export interface ElectricCliEnv {
  electricAgentsUrl: string
  electricAgentsIdentity: string
}

export interface SpawnCommandOptions {
  args?: string
}

export interface SendCommandOptions {
  type?: string
  json?: boolean
}

export interface ObserveCommandOptions {
  from?: string
}

export interface PsCommandOptions {
  type?: string
  status?: string
  parent?: string
}

export interface StartCommandOptions {}

export interface StartBuiltinCommandOptions {
  anthropicApiKey?: string
}

export interface StopCommandOptions {
  removeVolumes?: boolean
}

export interface ElectricCliHandlers {
  listTypes: () => Promise<void>
  inspectType: (name: string) => Promise<void>
  deleteType: (name: string) => Promise<void>
  spawn: (urlPath: string, options: SpawnCommandOptions) => Promise<void>
  send: (
    url: string,
    message: string,
    options: SendCommandOptions
  ) => Promise<void>
  observe: (url: string, options: ObserveCommandOptions) => Promise<void>
  inspect: (url: string) => Promise<void>
  ps: (options: PsCommandOptions) => Promise<void>
  kill: (url: string) => Promise<void>
  start: (options: StartCommandOptions) => Promise<StartedDevEnvironment>
  startBuiltin: (
    options: StartBuiltinCommandOptions
  ) => Promise<StartedBuiltinAgentsEnvironment>
  stop: (options: StopCommandOptions) => Promise<StoppedDevEnvironment>
  quickstart: (options: StartBuiltinCommandOptions) => Promise<void>
}

class CliError extends Error {}

interface InvocationEnv {
  npm_command?: string
  npm_config_user_agent?: string
}

function getDefaultElectricAgentsIdentity(): string {
  return `${userInfo().username}@${hostname()}`
}

export function getElectricCliEnv(
  env: NodeJS.ProcessEnv = process.env
): ElectricCliEnv {
  return {
    electricAgentsUrl: env.ELECTRIC_AGENTS_URL || DEFAULT_ELECTRIC_AGENTS_URL,
    electricAgentsIdentity:
      env.ELECTRIC_AGENTS_IDENTITY || getDefaultElectricAgentsIdentity(),
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function fail(message: string): never {
  throw new CliError(message)
}

function relativeTime(epochMs: number): string {
  const seconds = Math.floor((Date.now() - epochMs) / 1000)
  if (seconds < 5) return `just now`
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function parsePayload(input: string, json: boolean): unknown {
  if (json) {
    try {
      return JSON.parse(input)
    } catch (error) {
      fail(`Invalid JSON: ${getErrorMessage(error)}`)
    }
  }
  return { text: input }
}

function normalizeVariadicArg(
  value: string | Array<string> | undefined
): Array<string> {
  if (value === undefined) {
    return []
  }

  return Array.isArray(value) ? value : [value]
}

function getCommandActionArg(args: Array<unknown>): Command {
  return args[args.length - 1] as Command
}

function resolveCommandName(argv: Array<string>): string {
  const invoked = basename(argv[1] ?? ``)
  if (!invoked) {
    return `electric`
  }

  if (invoked === `index.js` || invoked === `index.ts` || invoked === `node`) {
    return `electric`
  }

  return invoked.replace(/\.(c|m)?js$/, ``)
}

function commandExample(commandName: string): string {
  return `${commandName} agent`
}

export function resolveCommandPrefix(
  argv: Array<string>,
  env: InvocationEnv = process.env
): string {
  if (env.npm_command === `exec`) {
    const userAgent = env.npm_config_user_agent ?? ``
    if (userAgent.startsWith(`pnpm/`)) {
      return `pnpx electric-ax agent`
    }
    if (userAgent.startsWith(`npm/`)) {
      return `npx electric-ax agent`
    }
  }

  return commandExample(resolveCommandName(argv))
}

async function electricAgentsFetch(
  env: ElectricCliEnv,
  path: string,
  opts: RequestInit = {}
): Promise<Response> {
  try {
    return await fetch(`${env.electricAgentsUrl}${path}`, {
      ...opts,
      headers: {
        'content-type': `application/json`,
        ...opts.headers,
      },
    })
  } catch (error) {
    fail(
      `Could not connect to ${env.electricAgentsUrl} — is the Electric Agents server running?\n` +
        `  Set ELECTRIC_AGENTS_URL to point to a different server.\n` +
        `  Original error: ${getErrorMessage(error)}`
    )
  }
}

async function parseJsonResponse(
  res: Response
): Promise<Record<string, unknown>> {
  const text = await res.text()
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return { error: { message: text || res.statusText } }
  }
}

function failFromResponse(data: Record<string, unknown>, res: Response): never {
  const err = data.error as Record<string, unknown> | undefined
  fail(String(err?.message ?? res.statusText))
}

async function fetchEntityTypes(
  env: ElectricCliEnv
): Promise<Array<ElectricAgentsEntityType>> {
  const res = await electricAgentsFetch(env, `/_electric/entity-types`)
  const data = await res.json()
  if (!res.ok) {
    fail(
      typeof data === `object` && data !== null
        ? String(
            (data as { error?: { message?: string } }).error?.message ??
              res.statusText
          )
        : res.statusText
    )
  }
  if (!Array.isArray(data)) {
    fail(`Unexpected response from server when listing entity types`)
  }
  return data as Array<ElectricAgentsEntityType>
}

async function listTypes(env: ElectricCliEnv): Promise<void> {
  const rows = await fetchEntityTypes(env)

  if (rows.length === 0) {
    console.log(`No entity types found`)
    return
  }

  const types = rows.map((entityType) => ({
    name: entityType.name,
    description: entityType.description,
    serve_endpoint: entityType.serve_endpoint,
  }))

  const { renderTypesTable } = await import(`./types-table.js`)
  renderTypesTable(types)
}

async function fetchEntities(
  env: ElectricCliEnv,
  options: PsCommandOptions = {}
): Promise<Array<ElectricAgentsEntityRow>> {
  const searchParams = new URLSearchParams()
  if (options.type) searchParams.set(`type`, options.type)
  if (options.status) searchParams.set(`status`, options.status)
  if (options.parent) searchParams.set(`parent`, options.parent)
  const suffix = searchParams.size > 0 ? `?${searchParams.toString()}` : ``
  const res = await electricAgentsFetch(env, `/_electric/entities${suffix}`)
  const data = await res.json()
  if (!res.ok) {
    fail(
      typeof data === `object` && data !== null
        ? String(
            (data as { error?: { message?: string } }).error?.message ??
              res.statusText
          )
        : res.statusText
    )
  }
  if (!Array.isArray(data)) {
    fail(`Unexpected response from server when listing entities`)
  }
  return data as Array<ElectricAgentsEntityRow>
}

async function inspectType(env: ElectricCliEnv, name: string): Promise<void> {
  const res = await electricAgentsFetch(
    env,
    `/_electric/entity-types/${encodeURIComponent(name)}`
  )
  const data = await parseJsonResponse(res)
  if (!res.ok) {
    failFromResponse(data, res)
  }

  console.log(JSON.stringify(data, null, 2))
}

async function deleteType(env: ElectricCliEnv, name: string): Promise<void> {
  const res = await electricAgentsFetch(
    env,
    `/_electric/entity-types/${encodeURIComponent(name)}`,
    { method: `DELETE` }
  )
  if (!res.ok) {
    const data = await parseJsonResponse(res)
    failFromResponse(data, res)
  }

  console.log(`Deleted entity type ${name}`)
}

async function spawnEntity(
  env: ElectricCliEnv,
  urlPath: string,
  options: SpawnCommandOptions
): Promise<void> {
  let spawnArgs: Record<string, unknown> = {}
  if (options.args) {
    try {
      spawnArgs = JSON.parse(options.args) as Record<string, unknown>
    } catch (error) {
      fail(`--args must be valid JSON: ${getErrorMessage(error)}`)
    }
  }

  const res = await electricAgentsFetch(env, urlPath, {
    method: `PUT`,
    body: JSON.stringify({ args: spawnArgs }),
  })

  const data = await parseJsonResponse(res)
  if (!res.ok) {
    failFromResponse(data, res)
  }

  const entity = data as { url?: string; status?: string; type?: string }
  if (!entity.url || !entity.status) {
    fail(`Unexpected response from server: ${JSON.stringify(data)}`)
  }

  console.log(
    `Spawned ${entity.url} (type: ${entity.type ?? `unknown`}, status: ${entity.status})`
  )
}

async function sendMessage(
  env: ElectricCliEnv,
  url: string,
  message: string,
  options: SendCommandOptions
): Promise<void> {
  const payload = parsePayload(message, options.json ?? false)

  const body: Record<string, unknown> = {
    from: env.electricAgentsIdentity,
    payload,
  }
  if (options.type) {
    body.type = options.type
  }

  const res = await electricAgentsFetch(env, `${url}/send`, {
    method: `POST`,
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const data = await parseJsonResponse(res)
    failFromResponse(data, res)
  }

  console.log(`Message sent`)
}

async function observeEntity(
  env: ElectricCliEnv,
  url: string,
  options: ObserveCommandOptions
): Promise<void> {
  if (!process.stdout.isTTY) {
    fail(`observe requires an interactive terminal`)
  }

  const { renderObserve } = await import(`./observe-ui.js`)
  renderObserve({
    entityUrl: url,
    baseUrl: env.electricAgentsUrl,
    identity: env.electricAgentsIdentity,
    initialOffset: options.from,
  })
}

async function inspectEntity(env: ElectricCliEnv, url: string): Promise<void> {
  const res = await electricAgentsFetch(env, url)
  const data = await parseJsonResponse(res)
  if (!res.ok) {
    failFromResponse(data, res)
  }

  console.log(JSON.stringify(data, null, 2))
}

async function listEntities(
  env: ElectricCliEnv,
  options: PsCommandOptions
): Promise<void> {
  const entities = await fetchEntities(env, options)

  if (entities.length === 0) {
    console.log(`No entities found`)
    return
  }

  entities.sort((a, b) => {
    const aTime = Number(a.updated_at) || 0
    const bTime = Number(b.updated_at) || 0
    return bTime - aTime
  })

  console.log(
    `${`URL`.padEnd(30)} ${`STATUS`.padEnd(10)} ${`CREATED`.padEnd(16)} ${`LAST ACTIVE`}`
  )
  console.log(
    `${`─`.repeat(30)} ${`─`.repeat(10)} ${`─`.repeat(16)} ${`─`.repeat(16)}`
  )

  for (const entity of entities) {
    const created = entity.created_at
      ? relativeTime(Number(entity.created_at))
      : `-`
    const lastActive = entity.updated_at
      ? relativeTime(Number(entity.updated_at))
      : `-`

    console.log(
      `${entity.url.padEnd(30)} ${entity.status.padEnd(10)} ${created.padEnd(16)} ${lastActive}`
    )
  }
}

async function killEntity(env: ElectricCliEnv, url: string): Promise<void> {
  const res = await electricAgentsFetch(env, url, {
    method: `DELETE`,
  })

  if (!res.ok) {
    const data = await parseJsonResponse(res)
    failFromResponse(data, res)
  }

  console.log(`Killed ${url}`)
}

function printStartedEnvironment(env: StartedDevEnvironment): void {
  console.log(
    [
      `Electric Agents dev environment is up.`,
      `Server + UI: ${env.uiUrl}`,
      `Docker project: ${env.composeProjectName}`,
    ].join(`\n`)
  )
}

function printStoppedEnvironment(env: StoppedDevEnvironment): void {
  console.log(
    [
      `Electric Agents dev environment is down.`,
      `Docker project: ${env.composeProjectName}`,
      env.removedVolumes ? `Volumes removed: yes` : `Volumes removed: no`,
    ].join(`\n`)
  )
}

// eslint-disable-next-line quotes
type StartModule = typeof import('./start.js')

let startModulePromise: Promise<StartModule> | null = null

async function loadStartModule(): Promise<StartModule> {
  startModulePromise ??= import(`./start.js`)
  return startModulePromise
}

export function createElectricCliHandlers(
  env: ElectricCliEnv,
  commandPrefix: string = commandExample(`electric`)
): ElectricCliHandlers {
  return {
    listTypes: () => listTypes(env),
    inspectType: (name) => inspectType(env, name),
    deleteType: (name) => deleteType(env, name),
    spawn: (urlPath, options) => spawnEntity(env, urlPath, options),
    send: (url, message, options) => sendMessage(env, url, message, options),
    observe: (url, options) => observeEntity(env, url, options),
    inspect: (url) => inspectEntity(env, url),
    ps: (options) => listEntities(env, options),
    kill: (url) => killEntity(env, url),
    start: async (options) => {
      const { startElectricAgentsDevEnvironment } = await loadStartModule()
      const started = await startElectricAgentsDevEnvironment(options)
      printStartedEnvironment(started)
      return started
    },
    startBuiltin: async (options) => {
      const { startBuiltinAgentsServer } = await loadStartModule()
      return startBuiltinAgentsServer(options, {
        agentServerUrl: env.electricAgentsUrl,
      })
    },
    stop: async (options) => {
      const { stopElectricAgentsDevEnvironment } = await loadStartModule()
      const stopped = await stopElectricAgentsDevEnvironment(options)
      printStoppedEnvironment(stopped)
      return stopped
    },
    quickstart: async (options) => {
      resolveAnthropicApiKey(options)
      const { startBuiltinAgentsServer, startElectricAgentsDevEnvironment } =
        await loadStartModule()
      const started = await startElectricAgentsDevEnvironment()
      printStartedEnvironment(started)
      console.log(``)
      console.log(
        [
          `electric agents server is up`,
          ``,
          `Open a separate terminal and run:`,
          `  ${commandPrefix} spawn /horton/onboarding`,
          `  ${commandPrefix} send /horton/onboarding "Please walk me through onboarding for the Electric agents"`,
          `  ${commandPrefix} observe /horton/onboarding`,
          ``,
          `UI: ${started.uiUrl}`,
          `This terminal will now run the built-in Horton server in the foreground.`,
        ].join(`\n`)
      )
      console.log(``)
      await startBuiltinAgentsServer(options, {
        agentServerUrl: started.uiUrl,
      })
    },
  }
}

function getHelpText(commandName: string): string {
  const agentsCommand = commandExample(commandName)

  return `
Environment:
  ELECTRIC_AGENTS_URL        Base URL of the server (default: ${DEFAULT_ELECTRIC_AGENTS_URL})
  ELECTRIC_AGENTS_IDENTITY   Sender identity for messages (default: ${getDefaultElectricAgentsIdentity()})
  ANTHROPIC_API_KEY          Required for '${agentsCommand} start-builtin' and '${agentsCommand} quickstart'

Examples:
  $ ${agentsCommand} types
  $ ${agentsCommand} spawn /horton/onboarding
  $ ${agentsCommand} send /horton/onboarding "Please walk me through onboarding for the Electric agents"
  $ ${agentsCommand} observe /horton/onboarding --from 0
  $ ${agentsCommand} start
  $ ${agentsCommand} start-builtin --anthropic-api-key sk-ant-...
  $ ${agentsCommand} stop --remove-volumes
`
}

export function createElectricProgram({
  env = getElectricCliEnv(),
  commandName = `electric`,
  commandPrefix = commandExample(commandName),
  handlers = createElectricCliHandlers(env, commandPrefix),
}: {
  env?: ElectricCliEnv
  handlers?: ElectricCliHandlers
  commandName?: string
  commandPrefix?: string
} = {}): Command {
  const program = new Command()

  program
    .name(commandName)
    .description(`Manage Electric tooling`)
    .showHelpAfterError()
    .showSuggestionAfterError()
    .addHelpText(`after`, getHelpText(commandName))

  const agentsCommand = program
    .command(`agent`)
    .alias(`agents`)
    .description(`Manage Electric Agents`)

  const typesCommand = agentsCommand
    .command(`types`)
    .description(`List entity types`)
    .action(async () => {
      await handlers.listTypes()
    })

  typesCommand
    .command(`inspect <name>`)
    .description(`Show entity type details`)
    .action(async (name: string) => {
      await handlers.inspectType(name)
    })

  typesCommand
    .command(`delete <name>`)
    .description(`Delete an entity type`)
    .action(async (name: string) => {
      await handlers.deleteType(name)
    })

  agentsCommand
    .command(`spawn <url-path>`)
    .description(`Spawn an entity from a typed URL path`)
    .option(`--args <json>`, `Spawn arguments as JSON`)
    .action(async (...actionArgs: Array<unknown>) => {
      const urlPath = actionArgs[0] as string
      const command = getCommandActionArg(actionArgs)
      await handlers.spawn(urlPath, command.opts<SpawnCommandOptions>())
    })

  agentsCommand
    .command(`send <url> <message...>`)
    .description(`Send a message to an entity`)
    .option(`--type <msg-type>`, `Message type`)
    .option(`--json`, `Parse message as JSON`)
    .action(async (...actionArgs: Array<unknown>) => {
      const url = actionArgs[0] as string
      const message = actionArgs[1] as string | Array<string> | undefined
      const command = getCommandActionArg(actionArgs)
      const messageText = normalizeVariadicArg(message).join(` `)
      await handlers.send(url, messageText, command.opts<SendCommandOptions>())
    })

  agentsCommand
    .command(`observe <url>`)
    .description(`Observe an entity conversation`)
    .option(`--from <offset>`, `Initial offset`)
    .action(async (...actionArgs: Array<unknown>) => {
      const url = actionArgs[0] as string
      const command = getCommandActionArg(actionArgs)
      await handlers.observe(url, command.opts<ObserveCommandOptions>())
    })

  agentsCommand
    .command(`inspect <url>`)
    .description(`Show entity details`)
    .action(async (url: string) => {
      await handlers.inspect(url)
    })

  agentsCommand
    .command(`ps`)
    .description(`List entities`)
    .option(`--type <type>`, `Filter by entity type`)
    .option(`--status <status>`, `Filter by status`)
    .option(`--parent <url>`, `Filter by parent URL`)
    .action(async (...actionArgs: Array<unknown>) => {
      const command = getCommandActionArg(actionArgs)
      await handlers.ps(command.opts<PsCommandOptions>())
    })

  agentsCommand
    .command(`kill <url>`)
    .description(`Delete an entity`)
    .action(async (url: string) => {
      await handlers.kill(url)
    })

  agentsCommand
    .command(`start`)
    .description(`Start the Electric Agents coordinator server`)
    .action(async (...actionArgs: Array<unknown>) => {
      const command = getCommandActionArg(actionArgs)
      await handlers.start(command.opts<StartCommandOptions>())
    })

  agentsCommand
    .command(`start-builtin`)
    .description(`Start runtime for Horton & other builtin agents`)
    .option(
      `--anthropic-api-key <key>`,
      `Anthropic API key for the builtin Horton server`
    )
    .action(async (...actionArgs: Array<unknown>) => {
      const command = getCommandActionArg(actionArgs)
      await handlers.startBuiltin(command.opts<StartBuiltinCommandOptions>())
    })

  agentsCommand
    .command(`stop`)
    .description(`Stop the local Electric Agents dev environment`)
    .option(`--remove-volumes`, `Remove Docker volumes as well`)
    .action(async (...actionArgs: Array<unknown>) => {
      const command = getCommandActionArg(actionArgs)
      await handlers.stop(command.opts<StopCommandOptions>())
    })

  agentsCommand
    .command(`quickstart`)
    .description(
      `Start the coordinator server, print onboarding steps, and run builtin agents locally`
    )
    .option(
      `--anthropic-api-key <key>`,
      `Anthropic API key for the builtin Horton server`
    )
    .action(async (...actionArgs: Array<unknown>) => {
      const command = getCommandActionArg(actionArgs)
      await handlers.quickstart(command.opts<StartBuiltinCommandOptions>())
    })

  const completionCommand = agentsCommand
    .command(`completion [action]`)
    .description(`Set up shell completion`)
    .addHelpText(
      `after`,
      `
Setup (add to your shell init file):

  Bash:  eval "$(${commandName} --completion)"        # add to .bashrc
  Zsh:   eval "$(${commandName} --completion)"        # add to .zshrc
  Fish:  ${commandName} --completion-fish | source    # add to config.fish

Auto-install (detects your shell and updates init file):
  ${commandName} agent completion install
`
    )
    .action((action?: string) => {
      if (action === `install`) {
        try {
          console.log(`Installing shell completions...`)
          installCompletions(commandName)
        } catch (error) {
          fail(
            `Could not install completions: ${getErrorMessage(error)}\n` +
              `  Try manual setup instead: eval "$(${commandName} --completion)"`
          )
        }
        return
      }

      console.log(`Set up shell completions for ${commandName}.\n`)
      console.log(`Add to your shell init file:`)
      console.log(`  Bash/Zsh:  eval "$(${commandName} --completion)"`)
      console.log(`  Fish:      ${commandName} --completion-fish | source\n`)
      console.log(`Or auto-install:  ${commandName} agent completion install`)
    })

  completionCommand.alias(`completions`)

  return program
}

export async function run(argv: Array<string> = process.argv): Promise<void> {
  const env = getElectricCliEnv()
  const commandName = resolveCommandName(argv)
  const commandPrefix = resolveCommandPrefix(argv)

  setupCompletions(env, commandName)
  if (argv.includes(`--compgen`)) return

  const program = createElectricProgram({ env, commandName, commandPrefix })

  if (argv.length <= 2) {
    program.help({ error: true })
  }

  await program.parseAsync(argv)
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false

  try {
    const scriptPath = realpathSync(resolvePath(process.argv[1]))
    const modulePath = realpathSync(fileURLToPath(import.meta.url))
    return scriptPath === modulePath
  } catch (error: unknown) {
    if (
      !(error instanceof Error) ||
      !(`code` in error) ||
      (error as NodeJS.ErrnoException).code !== `ENOENT`
    ) {
      throw error
    }
    const scriptPath = resolvePath(process.argv[1])
    const modulePath = fileURLToPath(import.meta.url)
    return scriptPath === modulePath
  }
}

if (isMainModule()) {
  run().catch((error) => {
    if (error instanceof CliError) {
      console.error(`Error: ${error.message}`)
    } else {
      console.error(`Fatal: ${getErrorMessage(error)}`)
    }

    process.exit(1)
  })
}
