import { describe, expect, it, vi } from 'vitest'
import { createElectricProgram, resolveCommandPrefix, run } from '../src/index'
import type {
  ElectricCliEnv,
  ElectricCliHandlers,
  StartedDevEnvironment,
  StoppedDevEnvironment,
} from '../src/index'

vi.mock(`../src/completions.js`, () => ({
  setupCompletions: vi.fn(),
  installCompletions: vi.fn(),
}))

const STARTED_ENV: StartedDevEnvironment = {
  port: 4437,
  uiUrl: `http://localhost:4437`,
  composeProjectName: `electric-agents-test`,
}

const STOPPED_ENV: StoppedDevEnvironment = {
  composeProjectName: `electric-agents-test`,
  removedVolumes: true,
}

const TEST_ENV: ElectricCliEnv = {
  electricAgentsUrl: `http://localhost:4437`,
  electricAgentsIdentity: `tester@example.com`,
}

function createHandlers() {
  return {
    listTypes: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    inspectType: vi
      .fn<(name: string) => Promise<void>>()
      .mockResolvedValue(undefined),
    deleteType: vi
      .fn<(name: string) => Promise<void>>()
      .mockResolvedValue(undefined),
    spawn: vi
      .fn<(urlPath: string, options: { args?: string }) => Promise<void>>()
      .mockResolvedValue(undefined),
    send: vi
      .fn<
        (
          url: string,
          message: string,
          options: { type?: string }
        ) => Promise<void>
      >()
      .mockResolvedValue(undefined),
    observe: vi
      .fn<(url: string, options: { from?: string }) => Promise<void>>()
      .mockResolvedValue(undefined),
    inspect: vi
      .fn<(url: string) => Promise<void>>()
      .mockResolvedValue(undefined),
    ps: vi
      .fn<
        (options: {
          type?: string
          status?: string
          parent?: string
        }) => Promise<void>
      >()
      .mockResolvedValue(undefined),
    kill: vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined),
    start: vi
      .fn<
        (options: {
          anthropicApiKey?: string
        }) => Promise<StartedDevEnvironment>
      >()
      .mockResolvedValue(STARTED_ENV),
    stop: vi
      .fn<
        (options: { removeVolumes?: boolean }) => Promise<StoppedDevEnvironment>
      >()
      .mockResolvedValue(STOPPED_ENV),
    quickstart: vi
      .fn<(options: { anthropicApiKey?: string }) => Promise<void>>()
      .mockResolvedValue(undefined),
  } satisfies ElectricCliHandlers
}

async function parse(argv: Array<string>, handlers = createHandlers()) {
  const program = createElectricProgram({
    env: TEST_ENV,
    handlers,
    commandName: `electric`,
  })

  program.exitOverride()
  await program.parseAsync([`node`, `electric`, ...argv])

  return handlers
}

describe(`createElectricProgram`, () => {
  it(`dispatches the root types command`, async () => {
    const handlers = await parse([`agent`, `types`])

    expect(handlers.listTypes).toHaveBeenCalledTimes(1)
  })

  it(`dispatches nested type inspection`, async () => {
    const handlers = await parse([`agent`, `types`, `inspect`, `chat`])

    expect(handlers.inspectType).toHaveBeenCalledWith(`chat`)
  })

  it(`passes spawn options through commander`, async () => {
    const handlers = await parse([
      `agent`,
      `spawn`,
      `/chat/test`,
      `--args`,
      `{"topic":"Turing test"}`,
    ])

    expect(handlers.spawn).toHaveBeenCalledWith(
      `/chat/test`,
      expect.objectContaining({
        args: `{"topic":"Turing test"}`,
      })
    )
  })

  it(`joins variadic send message args and keeps options`, async () => {
    const handlers = await parse([
      `agent`,
      `send`,
      `/chat/test`,
      `hello`,
      `world`,
      `--type`,
      `chat_message`,
    ])

    expect(handlers.send).toHaveBeenCalledWith(
      `/chat/test`,
      `hello world`,
      expect.objectContaining({
        type: `chat_message`,
      })
    )
  })

  it(`passes ps filters through commander options`, async () => {
    const handlers = await parse([
      `agent`,
      `ps`,
      `--type`,
      `chat`,
      `--status`,
      `running`,
      `--parent`,
      `/chat/root`,
    ])

    expect(handlers.ps).toHaveBeenCalledWith(
      expect.objectContaining({
        type: `chat`,
        status: `running`,
        parent: `/chat/root`,
      })
    )
  })

  it(`passes observe offsets through commander options`, async () => {
    const handlers = await parse([
      `agent`,
      `observe`,
      `/chat/test`,
      `--from`,
      `42`,
    ])

    expect(handlers.observe).toHaveBeenCalledWith(
      `/chat/test`,
      expect.objectContaining({
        from: `42`,
      })
    )
  })

  it(`passes start options through commander`, async () => {
    const handlers = await parse([
      `agent`,
      `start`,
      `--anthropic-api-key`,
      `sk-ant-test`,
    ])

    expect(handlers.start).toHaveBeenCalledWith(
      expect.objectContaining({
        anthropicApiKey: `sk-ant-test`,
      })
    )
  })

  it(`passes stop options through commander`, async () => {
    const handlers = await parse([`agent`, `stop`, `--remove-volumes`])

    expect(handlers.stop).toHaveBeenCalledWith(
      expect.objectContaining({
        removeVolumes: true,
      })
    )
  })

  it(`dispatches quickstart`, async () => {
    const handlers = await parse([`agent`, `quickstart`])

    expect(handlers.quickstart).toHaveBeenCalledTimes(1)
  })

  it(`registers the nested completion command`, async () => {
    const program = createElectricProgram({
      env: TEST_ENV,
      handlers: createHandlers(),
      commandName: `electric`,
    })
    const agentsCmd = program.commands.find((c) => c.name() === `agent`)
    const completionCmd = agentsCmd?.commands.find(
      (c) => c.name() === `completion`
    )
    expect(completionCmd).toBeDefined()
    expect(completionCmd!.description()).toMatch(/shell completion/i)
  })

  it(`keeps the plural alias working`, async () => {
    const handlers = await parse([`agents`, `types`])

    expect(handlers.listTypes).toHaveBeenCalledTimes(1)
  })
})

describe(`run`, () => {
  it(`resolves pnpx command prefixes`, () => {
    expect(
      resolveCommandPrefix([`node`, `/tmp/electric-ax`], {
        npm_command: `exec`,
        npm_config_user_agent: `pnpm/10.12.1 npm/? node/v24.11.1 darwin arm64`,
      })
    ).toBe(`pnpx electric-ax agent`)
  })

  it(`resolves npx command prefixes`, () => {
    expect(
      resolveCommandPrefix([`node`, `/tmp/electric-ax`], {
        npm_command: `exec`,
        npm_config_user_agent: `npm/11.6.2 node/v24.11.1 darwin arm64`,
      })
    ).toBe(`npx electric-ax agent`)
  })

  it(`resolves direct electric binary prefixes`, () => {
    expect(resolveCommandPrefix([`node`, `/usr/local/bin/electric`], {})).toBe(
      `electric agent`
    )
  })

  it(`returns early when argv contains --compgen`, async () => {
    await expect(
      run([`node`, `electric`, `--compzsh`, `--compgen`, `2`, ``, `electric `])
    ).resolves.toBeUndefined()
  })
})
