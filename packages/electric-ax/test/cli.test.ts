import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createElectricCliHandlers,
  createElectricProgram,
  formatQuickstartBackendStartedMessage,
  getElectricCliEnv,
  resolveCommandPrefix,
  run,
} from '../src/index'
import type {
  ElectricCliEnv,
  ElectricCliHandlers,
  StartedBuiltinAgentsEnvironment,
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

const STARTED_BUILTIN_ENV: StartedBuiltinAgentsEnvironment = {
  runnerId: `builtin-agents`,
  url: `pull-wake:builtin-agents`,
  agentServerUrl: `http://localhost:4437`,
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
    view: vi
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
    signal: vi
      .fn<
        (
          url: string,
          signal: string,
          options: { reason?: string; payload?: string }
        ) => Promise<void>
      >()
      .mockResolvedValue(undefined),
    kill: vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined),
    start: vi
      .fn<(options: object) => Promise<StartedDevEnvironment>>()
      .mockResolvedValue(STARTED_ENV),
    startBuiltin: vi
      .fn<
        (options: {
          anthropicApiKey?: string
        }) => Promise<StartedBuiltinAgentsEnvironment>
      >()
      .mockResolvedValue(STARTED_BUILTIN_ENV),
    stop: vi
      .fn<
        (options: { removeVolumes?: boolean }) => Promise<StoppedDevEnvironment>
      >()
      .mockResolvedValue(STOPPED_ENV),
    quickstart: vi
      .fn<(options: { anthropicApiKey?: string }) => Promise<void>>()
      .mockResolvedValue(undefined),
    init: vi
      .fn<(projectName?: string) => Promise<void>>()
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
  it(`uses the CLI identity as the default user principal header`, () => {
    const env = getElectricCliEnv({
      ELECTRIC_AGENTS_URL: `https://agents.example.test`,
      ELECTRIC_AGENTS_IDENTITY: `tester@example.com`,
    })

    expect(env.electricAgentsHeaders).toEqual({
      'electric-principal': `user:tester@example.com`,
    })
  })

  it(`allows the principal header to be overridden from the environment`, () => {
    const env = getElectricCliEnv({
      ELECTRIC_AGENTS_URL: `https://agents.example.test`,
      ELECTRIC_AGENTS_IDENTITY: `tester@example.com`,
      ELECTRIC_AGENTS_PRINCIPAL: `service:svc-test`,
      ELECTRIC_AGENTS_SERVER_HEADERS: JSON.stringify({
        Authorization: `Bearer token`,
      }),
    })

    expect(env.electricAgentsHeaders).toEqual({
      authorization: `Bearer token`,
      'electric-principal': `service:svc-test`,
    })
  })

  it(`formats the quickstart backend message in an ASCII box`, () => {
    const message = formatQuickstartBackendStartedMessage({
      commandPrefix: `electric agents`,
      uiUrl: `http://localhost:4437`,
      color: false,
    })

    expect(message).toContain(`╔`)
    expect(message).toContain(`╚`)
    expect(message).toContain(`║ electric agents server is up`)
    expect(message).toContain(`║   electric agents spawn /horton/onboarding`)
    expect(message).toContain(
      `║   electric agents send /horton/onboarding "Onboard me to Electric Agents"`
    )
    expect(message).toContain(`║   UI: http://localhost:4437`)
    expect(message).toContain(
      `║ Keep this window open to run the built-in agents`
    )
    expect(message).not.toContain(`\x1b[`)
  })

  it(`colors the quickstart box border and electric agents brand`, () => {
    const message = formatQuickstartBackendStartedMessage({
      commandPrefix: `electric agents`,
      uiUrl: `http://localhost:4437`,
      color: true,
      trueColor: true,
    })

    expect(message).toContain(`\x1b[38;2;86;232;234m╔`)
    expect(message).toContain(
      `\x1b[1m\x1b[38;2;86;232;234melectric agents\x1b[0m`
    )
    expect(message).toContain(`\x1b[38;2;86;232;234m║\x1b[0m Open`)
    expect(message).toContain(
      `\x1b[38;2;86;232;234m║\x1b[0m   electric agents spawn`
    )
    expect(message).toContain(`UI: \x1b[4mhttp://localhost:4437\x1b[24m`)
    expect(message).toContain(
      `\x1b[90mKeep this window open to run the built-in agents\x1b[0m`
    )
    expect(message).not.toContain(
      `\x1b[0m   \x1b[1m\x1b[38;2;86;232;234melectric agents\x1b[0m spawn`
    )
  })

  it(`dispatches the root types command`, async () => {
    const handlers = await parse([`agents`, `types`])

    expect(handlers.listTypes).toHaveBeenCalledTimes(1)
  })

  it(`dispatches nested type inspection`, async () => {
    const handlers = await parse([`agents`, `types`, `inspect`, `chat`])

    expect(handlers.inspectType).toHaveBeenCalledWith(`chat`)
  })

  it(`passes spawn options through commander`, async () => {
    const handlers = await parse([
      `agents`,
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
      `agents`,
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
      `agents`,
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

  it(`surfaces string error responses from entity listing`, async () => {
    const fetchMock = vi.spyOn(globalThis, `fetch`).mockResolvedValue(
      new Response(JSON.stringify({ error: `Missing electric-principal` }), {
        status: 401,
        headers: { 'content-type': `application/json` },
      })
    )

    try {
      await expect(createElectricCliHandlers(TEST_ENV).ps({})).rejects.toThrow(
        `Missing electric-principal`
      )
    } finally {
      fetchMock.mockRestore()
    }
  })

  it(`falls back to HTTP status when an error response has no message`, async () => {
    const fetchMock = vi
      .spyOn(globalThis, `fetch`)
      .mockResolvedValue(new Response(``, { status: 503 }))

    try {
      await expect(createElectricCliHandlers(TEST_ENV).ps({})).rejects.toThrow(
        `HTTP 503`
      )
    } finally {
      fetchMock.mockRestore()
    }
  })

  it(`passes observe offsets through commander options`, async () => {
    const handlers = await parse([
      `agents`,
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

  it(`passes view offsets through commander options`, async () => {
    const handlers = await parse([
      `agents`,
      `view`,
      `/chat/test`,
      `--from`,
      `42`,
    ])

    expect(handlers.view).toHaveBeenCalledWith(
      `/chat/test`,
      expect.objectContaining({
        from: `42`,
      })
    )
  })

  it(`passes signal arguments and options through commander`, async () => {
    const handlers = await parse([
      `agents`,
      `signal`,
      `/chat/test`,
      `SIGINT`,
      `--reason`,
      `stop current run`,
      `--payload`,
      `{"source":"test"}`,
    ])

    expect(handlers.signal).toHaveBeenCalledWith(
      `/chat/test`,
      `SIGINT`,
      expect.objectContaining({
        reason: `stop current run`,
        payload: `{"source":"test"}`,
      })
    )
  })

  it(`sends messages without legacy from attribution`, async () => {
    const fetchMock = vi.spyOn(globalThis, `fetch`).mockResolvedValue(
      new Response(JSON.stringify({ txid: `123` }), {
        status: 200,
        headers: { 'content-type': `application/json` },
      })
    )

    try {
      await createElectricCliHandlers(TEST_ENV).send(`/chat/test`, `hello`, {
        type: `chat_message`,
      })
      expect(fetchMock).toHaveBeenCalledWith(
        `http://localhost:4437/_electric/entities/chat/test/send`,
        expect.objectContaining({
          method: `POST`,
          body: JSON.stringify({
            payload: { text: `hello` },
            type: `chat_message`,
          }),
        })
      )
    } finally {
      fetchMock.mockRestore()
    }
  })

  it(`sends signal requests to the entity signal endpoint`, async () => {
    const fetchMock = vi.spyOn(globalThis, `fetch`).mockResolvedValue(
      new Response(JSON.stringify({ txid: 123 }), {
        status: 200,
        headers: { 'content-type': `application/json` },
      })
    )

    try {
      await createElectricCliHandlers(TEST_ENV).signal(`/chat/test`, `SIGUSR`, {
        reason: `custom`,
        payload: `{"ok":true}`,
      })
      expect(fetchMock).toHaveBeenCalledWith(
        `http://localhost:4437/_electric/entities/chat/test/signal`,
        expect.objectContaining({
          method: `POST`,
          body: JSON.stringify({
            signal: `SIGUSR`,
            reason: `custom`,
            payload: { ok: true },
          }),
        })
      )
    } finally {
      fetchMock.mockRestore()
    }
  })

  it(`dispatches start without anthropic options`, async () => {
    const handlers = await parse([`agents`, `start`])

    expect(handlers.start).toHaveBeenCalledWith({})
  })

  it(`passes start-builtin options through commander`, async () => {
    const handlers = await parse([
      `agents`,
      `start-builtin`,
      `--anthropic-api-key`,
      `sk-ant-test`,
    ])

    expect(handlers.startBuiltin).toHaveBeenCalledWith(
      expect.objectContaining({
        anthropicApiKey: `sk-ant-test`,
      })
    )
  })

  it(`passes stop options through commander`, async () => {
    const handlers = await parse([`agents`, `stop`, `--remove-volumes`])

    expect(handlers.stop).toHaveBeenCalledWith(
      expect.objectContaining({
        removeVolumes: true,
      })
    )
  })

  it(`dispatches quickstart`, async () => {
    const handlers = await parse([
      `agents`,
      `quickstart`,
      `--anthropic-api-key`,
      `sk-ant-test`,
    ])

    expect(handlers.quickstart).toHaveBeenCalledWith(
      expect.objectContaining({
        anthropicApiKey: `sk-ant-test`,
      })
    )
  })

  it(`blocks quickstart when no Anthropic API key is available`, async () => {
    const originalCwd = process.cwd()
    const originalKey = process.env.ANTHROPIC_API_KEY
    const tmpDir = mkdtempSync(join(tmpdir(), `electric-ax-quickstart-`))

    try {
      process.chdir(tmpDir)
      delete process.env.ANTHROPIC_API_KEY

      await expect(
        createElectricCliHandlers(TEST_ENV).quickstart({})
      ).rejects.toThrow(/ANTHROPIC_API_KEY/)
    } finally {
      process.chdir(originalCwd)
      if (originalKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY
      } else {
        process.env.ANTHROPIC_API_KEY = originalKey
      }
    }
  })

  it(`registers the nested completion command`, async () => {
    const program = createElectricProgram({
      env: TEST_ENV,
      handlers: createHandlers(),
      commandName: `electric`,
    })
    const agentsCmd = program.commands.find((c) => c.name() === `agents`)
    const completionCmd = agentsCmd?.commands.find(
      (c) => c.name() === `completion`
    )
    expect(completionCmd).toBeDefined()
    expect(completionCmd!.description()).toMatch(/shell completion/i)
  })
})

describe(`run`, () => {
  it(`resolves pnpx command prefixes`, () => {
    expect(
      resolveCommandPrefix([`node`, `/tmp/electric-ax`], {
        npm_command: `exec`,
        npm_config_user_agent: `pnpm/10.12.1 npm/? node/v24.11.1 darwin arm64`,
      })
    ).toBe(`pnpx electric-ax agents`)
  })

  it(`resolves npx command prefixes`, () => {
    expect(
      resolveCommandPrefix([`node`, `/tmp/electric-ax`], {
        npm_command: `exec`,
        npm_config_user_agent: `npm/11.6.2 node/v24.11.1 darwin arm64`,
      })
    ).toBe(`npx electric-ax agents`)
  })

  it(`resolves direct electric binary prefixes`, () => {
    expect(resolveCommandPrefix([`node`, `/usr/local/bin/electric`], {})).toBe(
      `electric agents`
    )
  })

  it(`returns early when argv contains --compgen`, async () => {
    await expect(
      run([`node`, `electric`, `--compzsh`, `--compgen`, `2`, ``, `electric `])
    ).resolves.toBeUndefined()
  })
})
