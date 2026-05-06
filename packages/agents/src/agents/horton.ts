import fs from 'node:fs'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { completeSimple, getModel } from '@mariozechner/pi-ai'
import { eq, not, queryOnce } from '@durable-streams/state'
import { z } from 'zod'
import { serverLog } from '../log'
import { createHortonDocsSupport } from '../docs/knowledge-base'
import { createSkillTools } from '../skills/tools'
import { createSpawnWorkerTool } from '../tools/spawn-worker'
import {
  modelChoiceValues,
  REASONING_EFFORT_VALUES,
  resolveBuiltinModelConfig,
  type BuiltinAgentModelConfig,
  type BuiltinModelCatalog,
  type BuiltinModelChoice,
} from '../model-catalog'
import type { AgentTool, StreamFn } from '@mariozechner/pi-agent-core'
import type {
  EntityRegistry,
  HandlerContext,
  WakeEvent,
} from '@electric-ax/agents-runtime'
import {
  createBashTool,
  createEditTool,
  createReadFileTool,
  createWriteTool,
  braveSearchTool,
  fetchUrlTool,
} from '@electric-ax/agents-runtime/tools'
import type { MessageReceived } from '@electric-ax/agents-runtime'
import type { SkillsRegistry } from '../skills/types'

const TITLE_MODEL = `claude-haiku-4-5-20251001`

export const HORTON_MODEL = `claude-sonnet-4-6`

let anthropic: Anthropic | null = null
function getClient(): Anthropic {
  if (!anthropic) {
    anthropic = new Anthropic()
  }
  return anthropic
}

const TITLE_SYSTEM_PROMPT =
  `You generate concise chat session titles in 3-5 words. ` +
  `Respond with only the title, no quotes, no punctuation, no preamble.`

const TITLE_USER_PROMPT = (userMessage: string): string =>
  `User request:\n${userMessage}`

async function defaultHaikuCall(userPrompt: string): Promise<string> {
  const client = getClient()
  const res = await client.messages.create({
    model: TITLE_MODEL,
    max_tokens: 64,
    system: TITLE_SYSTEM_PROMPT,
    messages: [{ role: `user`, content: userPrompt }],
  })
  const block = res.content[0]
  return block?.type === `text` ? block.text : ``
}

const TITLE_STOP_WORDS = new Set([
  `a`,
  `an`,
  `and`,
  `are`,
  `can`,
  `for`,
  `from`,
  `help`,
  `i`,
  `in`,
  `into`,
  `is`,
  `it`,
  `look`,
  `me`,
  `my`,
  `need`,
  `of`,
  `on`,
  `or`,
  `please`,
  `the`,
  `this`,
  `to`,
  `we`,
  `with`,
  `you`,
])

const TITLE_IGNORED_WORDS = new Set([
  `dist`,
  `js`,
  `json`,
  `jsx`,
  `md`,
  `package`,
  `packages`,
  `src`,
  `ts`,
  `tsx`,
  `yaml`,
  `yml`,
])

function toTitleWord(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
}

function buildFallbackTitle(userMessage: string): string {
  const cleaned = userMessage
    .replace(/`[^`]*`/g, ` `)
    .replace(/[./\\_-]+/g, ` `)
    .replace(/[^a-zA-Z0-9\s]/g, ` `)
    .replace(/\s+/g, ` `)
    .trim()

  const rawWords = cleaned.split(/\s+/).filter(Boolean)
  const seen = new Set<string>()
  const informativeWords: Array<string> = []
  const backupWords: Array<string> = []

  for (const rawWord of rawWords) {
    const word = rawWord.toLowerCase()
    if (seen.has(word)) continue
    seen.add(word)

    if (!/^[a-z0-9]+$/i.test(word)) continue
    if (word.length < 2 || /^\d+$/.test(word)) continue
    if (TITLE_IGNORED_WORDS.has(word)) continue

    const titled = toTitleWord(word)
    if (backupWords.length < 5) backupWords.push(titled)
    if (TITLE_STOP_WORDS.has(word)) continue
    informativeWords.push(titled)
  }

  const selected =
    informativeWords.length >= 2 ? informativeWords.slice(0, 5) : backupWords
  return selected.join(` `).slice(0, 80).trim() || `Untitled Chat`
}

function selectTitleModelChoice(
  catalog: BuiltinModelCatalog,
  modelConfig: BuiltinAgentModelConfig
): BuiltinModelChoice {
  const configuredProvider = modelConfig.provider ?? `anthropic`
  const preferredIdsByProvider: Record<string, Array<string>> = {
    anthropic: [`claude-3-5-haiku-latest`, `claude-3-5-haiku-20241022`],
    openai: [`gpt-4.1-nano`, `gpt-4o-mini`, `gpt-4.1-mini`],
    'openai-codex': [`gpt-5.4-mini`, `gpt-5.1-codex-mini`],
  }

  for (const provider of [configuredProvider, `openai`, `anthropic`]) {
    for (const id of preferredIdsByProvider[provider] ?? []) {
      const choice = catalog.choices.find(
        (candidate) => candidate.provider === provider && candidate.id === id
      )
      if (choice) return choice
    }

    const nonReasoningChoice = catalog.choices.find(
      (candidate) =>
        candidate.provider === provider && candidate.reasoning === false
    )
    if (nonReasoningChoice) return nonReasoningChoice
  }

  return (
    catalog.choices.find(
      (candidate) =>
        candidate.provider === configuredProvider &&
        candidate.id === String(modelConfig.model)
    ) ?? catalog.defaultChoice
  )
}

function createConfiguredTitleCall(
  catalog: BuiltinModelCatalog,
  modelConfig: BuiltinAgentModelConfig,
  logPrefix: string
): (prompt: string) => Promise<string> {
  const choice = selectTitleModelChoice(catalog, modelConfig)

  return async (prompt: string) => {
    const model = getModel(
      choice.provider,
      choice.id as Parameters<typeof getModel>[1]
    )
    if (!model) {
      throw new Error(
        `unknown title model "${choice.id}" for provider "${choice.provider}"`
      )
    }

    serverLog.info(
      `${logPrefix} title generation using ${choice.provider}:${choice.id}`
    )

    const apiKey =
      choice.provider === modelConfig.provider && modelConfig.getApiKey
        ? await modelConfig.getApiKey(choice.provider)
        : undefined
    const res = await completeSimple(
      model,
      {
        systemPrompt: TITLE_SYSTEM_PROMPT,
        messages: [{ role: `user`, content: prompt, timestamp: Date.now() }],
      },
      {
        maxTokens: choice.reasoning ? 1024 : 64,
        ...(choice.reasoning && { reasoning: `low` as const }),
        ...(apiKey && { apiKey }),
      }
    )
    const text = res.content.find((block) => block.type === `text`)?.text
    if (!text || text.trim().length === 0) {
      const contentTypes =
        res.content.map((block) => block.type).join(`,`) || `none`
      throw new Error(
        `empty LLM title response from ${choice.provider}:${choice.id} stopReason=${res.stopReason} errorMessage=${res.errorMessage ?? `none`} contentTypes=${contentTypes}`
      )
    }
    return text
  }
}

export async function generateTitle(
  userMessage: string,
  llmCall: (prompt: string) => Promise<string> = defaultHaikuCall,
  onFallback?: (reason: string) => void
): Promise<string> {
  try {
    const raw = await llmCall(TITLE_USER_PROMPT(userMessage))
    const title = raw.trim()
    if (title.length > 0) return title
    onFallback?.(`empty LLM title response`)
    return buildFallbackTitle(userMessage)
  } catch (err) {
    onFallback?.(err instanceof Error ? err.message : String(err))
    return buildFallbackTitle(userMessage)
  }
}

export function buildHortonSystemPrompt(
  workingDirectory: string,
  opts: {
    hasDocsSupport?: boolean
    hasSkills?: boolean
    docsUrl?: string
    modelProvider?: string
    modelId?: string
  } = {}
): string {
  const docsTools = opts.hasDocsSupport
    ? `\n- search_durable_agents_docs: hybrid search over the built-in Durable Agents docs index`
    : ``
  const skillsTools = opts.hasSkills
    ? `\n- use_skill: load a skill (knowledge, instructions, or a tutorial) into your context to help with the user's request\n- remove_skill: unload a skill from context when you're done with it`
    : ``
  const docsGuidance = opts.hasDocsSupport
    ? `\n- For ANY question about Electric Agents, Durable Agents, or this framework, ALWAYS use search_durable_agents_docs FIRST. Do not use web_search or fetch_url for Electric Agents topics unless the docs search returns no useful results.\n- The search tool returns chunk content directly — you do not need to read the source files.\n- Use repo read/bash tools only for non-doc files or when you need to inspect exact implementation code in the workspace.`
    : ``
  const skillsGuidance = opts.hasSkills
    ? `\n# Skills\nYou have access to skills — specialized knowledge and guided workflows you can load on demand. Your context includes a skills catalog listing what's available. When the user's request matches a skill's description or keywords, load it with use_skill.

Some skills are user-invocable — the user can trigger them with a slash command like \`/quickstart\`. When you see a message starting with \`/\` followed by a skill name, load that skill immediately with use_skill. Pass any text after the skill name as args.

## IMPORTANT: How to use a loaded skill

When you load a skill, it becomes your primary directive for that interaction. Follow the skill's instructions exactly:

1. **Read all reference files first.** The use_skill tool response lists reference files with absolute paths. Read ALL of them with your read tool before responding to the user. These files contain the actual content the skill needs — without them you're guessing.
2. **Follow the skill's conversation flow.** If the skill defines steps, follow them in order. Do not improvise your own approach.
3. **Adopt the skill's persona and teaching style.** The skill defines how to interact — follow it.
4. **Unload when done.** Use remove_skill to free context space when the skill's workflow is complete.

Do NOT load a skill and then ignore its instructions. The skill is there because it contains a tested, specific workflow. Your job is to execute it faithfully.`
    : ``
  const onboardingGuidance = `\n# Onboarding
When a user is new or asks how to get started with Electric Agents, **don't assume a single path**. Present the options and let them choose:

- **Learn the concepts first** → Explain what Electric Agents is, answer questions, point to docs.
  Use search_durable_agents_docs to look up answers. Only load the quickstart skill if the user explicitly asks for a hands-on guided tutorial.

- **Hands-on guided tutorial** → Load the quickstart skill (or tell them to type \`/quickstart\`).
  This is a step-by-step build that takes them from zero to a running app.
  Only load it when the user explicitly wants to build something hands-on.

- **Scaffold a new project** → Load the init skill.
  This sets up project structure and orients them in the codebase.

- **Have a specific question?** → Answer it directly.
  Use search_durable_agents_docs first, then fall back to fetch_url or general knowledge if needed.

Don't force onboarding. If someone just wants to chat or code, let them. When in doubt, ask what they'd like to do rather than picking a path for them.`
  const docsUrlGuidance = opts.docsUrl
    ? `\n# Electric Agents documentation
- ${opts.hasDocsSupport ? `If search_durable_agents_docs is available, use it first (faster, hybrid search).` : `Use fetch_url to look up documentation pages.`}
- The Electric Agents docs site is at ${opts.docsUrl}
- The docs site covers: Usage (entity definition, handlers, tools, state, spawning, coordination, waking, shared state, client integration, app setup), Reference (handler context, entity definitions, configurations, tools, state proxies, wake events, registries), Entities (Horton, Worker), and Patterns (Manager-Worker, Pipeline, Map-Reduce, Dispatcher, Blackboard, Reactive Observers).
- For general coding questions unrelated to Electric Agents, use web_search or your own knowledge.`
    : ``
  const modelGuidance =
    opts.modelProvider && opts.modelId
      ? `\n# Runtime model
You are currently running via provider "${opts.modelProvider}" with model "${opts.modelId}". If the user asks what model or provider you are using, answer with these exact runtime values. Do not infer your model identity from training data or from the name of another coding tool.`
      : ``
  return `You are Horton, a friendly and capable assistant. You can chat, research the web, read and edit code, run shell commands, and dispatch subagents (workers) for isolated subtasks. Be warm and engaging in conversation; be precise and concrete when working with code.

# Greetings
When a user opens with a greeting ("hi", "hello", "hey", etc.) or a broad statement like "I want to learn about Electric Agents", respond warmly and introduce yourself. Briefly explain what you can help with and ask what they'd like to do — don't jump straight into a skill or workflow. Let the user tell you what they need before you start loading skills or running tools.

# Tools
- bash: run shell commands
- read: read a file
- write: create or overwrite a file
- edit: targeted string replacement in an existing file (you must read the file first)
- web_search: search the web
- fetch_url: fetch and convert a URL to markdown
- spawn_worker: dispatch a subagent for an isolated task
${docsTools}${skillsTools}

# Working with files
- Prefer edit over write when modifying existing files.
- You must read a file before you can edit it.
- Use absolute paths or paths relative to the current working directory.
${modelGuidance}${docsGuidance}${skillsGuidance}${onboardingGuidance}${docsUrlGuidance}

# Risky actions
Pause and confirm with the user before:
- Destructive operations (deleting files, rm -rf, dropping data, force-pushing)
- Hard-to-reverse operations (git reset --hard, removing dependencies)
- Actions visible to others (pushing code, opening PRs, sending messages)

# Parallelism
Run independent tool calls in parallel. Only run sequentially when one call depends on the result of another.

# When to spawn a worker
Dispatch a worker when:
- The subtask involves long research that would clutter our conversation.
- The subtask is independent and can run in parallel with other work.
- You need an isolated context (e.g., focused coding on one file without pulling its full content into our chat).

When you spawn a worker, write its system prompt the way you'd brief a colleague who just walked in: include file paths, line numbers, what specifically to do, and what form of answer you want back. The system prompt sets the worker's persona and constraints; the required initialMessage is the concrete task you're handing off — that's what kicks the worker off, so without it the worker sits idle.

After spawning, end your turn (optionally with a brief "I've dispatched a worker for X; I'll respond when it finishes"). When the worker finishes, you'll receive a message describing which worker completed and what it returned. Multiple workers may finish at different times — check the message for the worker URL to know which one you're hearing about.

# Reporting
Report outcomes faithfully. If a command failed, say so with the relevant output. If you didn't run a verification step, say that rather than implying you did. Don't hedge confirmed results with unnecessary disclaimers.

Working directory: ${workingDirectory}
The current year is ${new Date().getFullYear()}.`
}

export function createHortonTools(
  workingDirectory: string,
  ctx: HandlerContext,
  readSet: Set<string>,
  opts: {
    docsSearchTool?: AgentTool
    modelConfig?: ReturnType<typeof resolveBuiltinModelConfig>
  } = {}
): Array<AgentTool> {
  return [
    createBashTool(workingDirectory),
    createReadFileTool(workingDirectory, readSet),
    createWriteTool(workingDirectory, readSet),
    createEditTool(workingDirectory, readSet),
    braveSearchTool,
    fetchUrlTool,
    createSpawnWorkerTool(ctx, opts.modelConfig),
    ...(opts.docsSearchTool ? [opts.docsSearchTool] : []),
  ]
}

function payloadToTitleText(payload: unknown): string {
  if (typeof payload === `string`) return payload
  if (payload == null) return ``
  if (typeof payload === `object`) {
    const text = (payload as Record<string, unknown>).text
    return typeof text === `string` ? text : JSON.stringify(payload)
  }
  return String(payload)
}

export async function extractFirstUserMessage(
  ctx: HandlerContext
): Promise<string | null> {
  const firstMessage = await queryOnce((q) =>
    q
      .from({ inbox: ctx.db.collections.inbox })
      .where(({ inbox }) => not(eq(inbox.from, `system`)))
      .orderBy(({ inbox }) => inbox._seq, `asc`)
      .findOne()
  )

  if (!firstMessage) return null
  const text = payloadToTitleText((firstMessage as MessageReceived).payload)
  return text.length > 0 ? text : null
}

type HortonDocsSupport = NonNullable<ReturnType<typeof createHortonDocsSupport>>

function readAgentsMd(workingDirectory: string): string | null {
  const agentsMdPath = path.join(workingDirectory, `AGENTS.md`)
  try {
    if (!fs.existsSync(agentsMdPath) || !fs.statSync(agentsMdPath).isFile()) {
      return null
    }
    const content = fs.readFileSync(agentsMdPath, `utf8`)
    return [
      `<context_file kind="instructions" path="${agentsMdPath}">`,
      content,
      `</context_file>`,
    ].join(`\n`)
  } catch {
    return null
  }
}

function createAssistantHandler(options: {
  workingDirectory: string
  streamFn?: StreamFn
  docsSupport: HortonDocsSupport | null
  docsSearchTool?: AgentTool
  skillsRegistry: SkillsRegistry | null
  modelCatalog: BuiltinModelCatalog
  docsUrl?: string
}) {
  const {
    workingDirectory,
    streamFn,
    docsSupport,
    docsSearchTool,
    skillsRegistry,
    modelCatalog,
    docsUrl,
  } = options
  const hasSkills = Boolean(skillsRegistry && skillsRegistry.catalog.size > 0)

  return async function assistantHandler(
    ctx: HandlerContext,
    wake: WakeEvent
  ): Promise<void> {
    const readSet = new Set<string>()
    // `workingDirectory` may be overridden per-spawn — used by the
    // desktop UI's directory picker so each Horton session can run
    // against its own project root without restarting the runtime.
    const effectiveCwd =
      typeof ctx.args.workingDirectory === `string` &&
      ctx.args.workingDirectory.trim().length > 0
        ? ctx.args.workingDirectory
        : workingDirectory
    const modelConfig = resolveBuiltinModelConfig(modelCatalog, ctx.args)
    const agentsMd = readAgentsMd(effectiveCwd)
    const tools = [
      ...ctx.electricTools,
      ...createHortonTools(effectiveCwd, ctx, readSet, {
        docsSearchTool,
        modelConfig,
      }),
      ...(skillsRegistry && skillsRegistry.catalog.size > 0
        ? createSkillTools(skillsRegistry, ctx)
        : []),
    ]

    const titlePromise =
      ctx.firstWake && !ctx.tags.title
        ? (async () => {
            const firstUserMessage = await extractFirstUserMessage(ctx)
            if (!firstUserMessage) return

            let title: string | null = null
            try {
              const result = await generateTitle(
                firstUserMessage,
                createConfiguredTitleCall(
                  modelCatalog,
                  modelConfig,
                  `[horton ${ctx.entityUrl}]`
                ),
                (reason) => {
                  serverLog.warn(
                    `[horton ${ctx.entityUrl}] title generation fell back to local title: ${reason}`
                  )
                }
              )
              if (result.length > 0) title = result
            } catch (err) {
              serverLog.warn(
                `[horton ${ctx.entityUrl}] title generation failed: ${err instanceof Error ? err.message : String(err)}`
              )
            }

            if (title !== null) {
              try {
                await ctx.setTag(`title`, title)
              } catch (err) {
                serverLog.warn(
                  `[horton ${ctx.entityUrl}] setTag failed: ${err instanceof Error ? err.message : String(err)}`
                )
              }
            }
          })()
        : Promise.resolve()

    if (docsSupport) {
      ctx.useContext({
        sourceBudget: 100_000,
        sources: {
          docs_toc: {
            content: () => docsSupport.renderCompressedToc(),
            max: 3_000,
            cache: `stable`,
          },
          retrieved_docs: {
            content: () =>
              docsSupport.renderRetrievedDocsSource(
                wake,
                ctx.events,
                ctx.db.collections.inbox.toArray
              ),
            max: 6_000,
            cache: `volatile`,
          },
          conversation: {
            content: () => ctx.timelineMessages(),
            cache: `volatile`,
          },
          ...(agentsMd
            ? {
                agents_md: {
                  content: () => agentsMd,
                  max: 20_000,
                  cache: `stable` as const,
                },
              }
            : {}),
          ...(skillsRegistry && skillsRegistry.catalog.size > 0
            ? {
                skills_catalog: {
                  content: () => skillsRegistry.renderCatalog(2_000),
                  max: 2_000,
                  cache: `stable` as const,
                },
              }
            : {}),
        },
      })
    } else if (skillsRegistry && skillsRegistry.catalog.size > 0) {
      ctx.useContext({
        sourceBudget: 100_000,
        sources: {
          skills_catalog: {
            content: () => skillsRegistry.renderCatalog(2_000),
            max: 2_000,
            cache: `stable` as const,
          },
          conversation: {
            content: () => ctx.timelineMessages(),
            cache: `volatile`,
          },
          ...(agentsMd
            ? {
                agents_md: {
                  content: () => agentsMd,
                  max: 20_000,
                  cache: `stable` as const,
                },
              }
            : {}),
        },
      })
    } else if (agentsMd) {
      ctx.useContext({
        sourceBudget: 100_000,
        sources: {
          conversation: {
            content: () => ctx.timelineMessages(),
            cache: `volatile`,
          },
          agents_md: {
            content: () => agentsMd,
            max: 20_000,
            cache: `stable`,
          },
        },
      })
    }

    ctx.useAgent({
      systemPrompt: buildHortonSystemPrompt(effectiveCwd, {
        hasDocsSupport: Boolean(docsSupport),
        hasSkills,
        docsUrl,
        modelProvider: modelConfig.provider,
        modelId: String(modelConfig.model),
      }),
      ...modelConfig,
      tools,
      ...(streamFn && { streamFn }),
    })
    await ctx.agent.run()
    await titlePromise
  }
}

export function registerHorton(
  registry: EntityRegistry,
  options: {
    workingDirectory: string
    streamFn?: StreamFn
    skillsRegistry?: SkillsRegistry | null
    modelCatalog: BuiltinModelCatalog
    docsUrl?: string
  }
): Array<string> {
  const {
    workingDirectory,
    streamFn,
    skillsRegistry = null,
    modelCatalog,
  } = options
  const docsUrl = options.docsUrl ?? process.env.HORTON_DOCS_URL

  if (process.env.BRAVE_SEARCH_API_KEY) {
    serverLog.info(`[horton] Web search: using Brave Search API`)
  } else {
    serverLog.warn(
      `[horton] BRAVE_SEARCH_API_KEY not set — web search will fall back to Anthropic built-in search (uses your ANTHROPIC_API_KEY)`
    )
  }

  const docsSupport = createHortonDocsSupport(workingDirectory)
  const docsSearchTool = docsSupport?.createSearchTool()

  void docsSupport?.ensureReady().catch((error) => {
    serverLog.warn(
      `[horton-docs] warmup failed: ${error instanceof Error ? error.message : String(error)}`
    )
  })

  const assistantHandler = createAssistantHandler({
    workingDirectory,
    streamFn,
    docsSupport,
    docsSearchTool,
    skillsRegistry,
    modelCatalog,
    docsUrl,
  })

  const hortonCreationSchema = z.object({
    model: z
      .enum(modelChoiceValues(modelCatalog))
      .default(modelCatalog.defaultChoice.value),
    reasoningEffort: z
      .enum(REASONING_EFFORT_VALUES)
      .default(`auto`)
      .describe(
        `Reasoning effort for compatible reasoning models. Auto uses a safe provider default.`
      ),
    workingDirectory: z
      .string()
      .optional()
      .describe(
        `Working directory for file operations. Defaults to the server's configured cwd.`
      ),
  })

  registry.define(`horton`, {
    description: `Friendly capable assistant — chat, code, research, dispatch`,
    creationSchema: hortonCreationSchema,
    handler: assistantHandler,
  })

  const typeNames = [`horton`]
  if (streamFn) {
    registry.define(`chat`, {
      description: `Compatibility alias for the built-in assistant type.`,
      handler: assistantHandler,
    })
    typeNames.push(`chat`)
  }

  return typeNames
}
