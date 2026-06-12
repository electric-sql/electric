import path from 'node:path'
import { z } from 'zod'
import { serverLog } from '../log'
import { createHortonDocsSupport } from '../docs/knowledge-base'
import { createSpawnWorkerTool } from '../tools/spawn-worker'
import { createObservePgSyncTool } from '../tools/observe-pg-sync'
import { createForkTool } from '../tools/fork'
import { createSetTitleTool } from '../tools/set-title'
import {
  modelInputSchemaDefs,
  modelChoiceValues,
  REASONING_EFFORT_VALUES,
  resolveBuiltinModelConfig,
  resolveBuiltinModelSourceBudget,
  type BuiltinAgentModelConfig,
  type BuiltinModelCatalog,
} from '../model-catalog'
import type { AgentTool, StreamFn } from '@mariozechner/pi-agent-core'
import {
  buildSkillSlashCommands,
  createContextSkillLoader,
  completeWithLowCostModel,
} from '@electric-ax/agents-runtime'
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
  createFetchUrlTool,
  createSendTool,
} from '@electric-ax/agents-runtime/tools'
import type { Sandbox } from '@electric-ax/agents-runtime/sandbox'
import { mcp } from '@electric-ax/agents-mcp'
import type { SkillsRegistry } from '@electric-ax/agents-runtime'

export const HORTON_MODEL = `claude-sonnet-4-6`

const TITLE_SYSTEM_PROMPT =
  `You generate a concise 3-5 word chat session title from the user's first message. ` +
  `Respond with only the title — no quotes, punctuation, preamble, or explanation. ` +
  `The user may reference images, files, or attachments you cannot see; infer a title ` +
  `from their intent anyway. Never apologize or say anything is missing — always ` +
  `output a short title.`
const TITLE_USER_PROMPT = (userMessage: string): string =>
  `User request:\n${userMessage}`
const TITLE_GENERATION_TIMEOUT_MS = 8_000
const HORTON_SKILLS_SLASH_COMMAND_OWNER = `horton:skills`

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

function createConfiguredTitleCall(
  catalog: BuiltinModelCatalog,
  modelConfig: BuiltinAgentModelConfig,
  logPrefix: string
): (prompt: string) => Promise<string> {
  return (prompt: string) =>
    completeWithLowCostModel({
      catalog,
      modelConfig,
      log: (message) => serverLog.info(message),
      logPrefix,
      purpose: `title generation`,
      systemPrompt: TITLE_SYSTEM_PROMPT,
      prompt,
      maxTokens: 64,
    })
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  description: string
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${description} timed out after ${ms}ms`))
    }, ms)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout)
  })
}

// A real title is a few words; a model that ignored the instructions and went
// conversational (e.g. apologizing about attachments it can't see) returns a
// sentence — reject it so we fall back to the locally-derived title.
function looksLikeNonTitle(title: string): boolean {
  if (title.split(/\s+/).filter(Boolean).length > 8) return true
  // The prompt forbids punctuation, so `!?,` betray a conversational reply
  // even under the word cap; dots/hyphens stay legal for technical titles.
  return /[!?,]/.test(title)
}

export async function generateTitle(
  userMessage: string,
  llmCall: (prompt: string) => Promise<string>,
  onFallback?: (reason: string) => void
): Promise<string> {
  try {
    const raw = await llmCall(TITLE_USER_PROMPT(userMessage))
    const title = raw.trim()
    if (title.length > 0 && !looksLikeNonTitle(title)) return title
    onFallback?.(
      title.length === 0 ? `empty LLM title response` : `non-title LLM response`
    )
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
    hasEventSourceTools?: boolean
    hasScheduleTools?: boolean
    hasSkills?: boolean
    docsUrl?: string
    modelProvider?: string
    modelId?: string
  } = {}
): string {
  const docsTools = opts.hasDocsSupport
    ? `\n- search_electric_agents_docs: hybrid search over the built-in Electric Agents docs index`
    : ``
  const eventSourceTools = opts.hasEventSourceTools
    ? `\n- list_event_sources: list external webhook/event feeds you can subscribe to, including available buckets and parameters\n- subscribe_event_source: subscribe yourself to one of those feeds or buckets so matching future events wake you\n- list_event_source_subscriptions: list your active event source subscriptions\n- unsubscribe_event_source: remove one of your event source subscriptions by id`
    : ``
  const titleTool = `\n- set_title: set or rename this chat session's UI title`
  const scheduleTools = opts.hasScheduleTools
    ? `\n- upsert_cron_schedule: create or update a recurring cron wake for yourself. Always include payload with the concrete instruction/message you should receive when the cron fires.\n- delete_schedule: delete one of your cron or future-send schedules by stable id\n- list_schedules: list your manifest-backed cron and future-send schedules`
    : ``
  const skillsTools = opts.hasSkills
    ? `\n- use_skill: load a skill (knowledge, instructions, or a tutorial) into your context to help with the user's request\n- remove_skill: unload a skill from context when you're done with it`
    : ``
  const docsGuidance = opts.hasDocsSupport
    ? `\n- For ANY question about Electric Agents or this framework, ALWAYS use search_electric_agents_docs FIRST. Do not use web_search or fetch_url for Electric Agents topics unless the docs search returns no useful results.\n- The search tool returns chunk content directly — you do not need to read the source files.\n- Use repo read/bash tools only for non-doc files or when you need to inspect exact implementation code in the workspace.`
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
  Use search_electric_agents_docs to look up answers. Only load the quickstart skill if the user explicitly asks for a hands-on guided tutorial.

- **Hands-on guided tutorial** → Load the quickstart skill (or tell them to type \`/quickstart\`).
  This is a step-by-step build that takes them from zero to a running app.
  Only load it when the user explicitly wants to build something hands-on.

- **Scaffold a new project** → Load the init skill.
  This sets up project structure and orients them in the codebase.

- **Have a specific question?** → Answer it directly.
  Use search_electric_agents_docs first, then fall back to fetch_url or general knowledge if needed.

Don't force onboarding. If someone just wants to chat or code, let them. When in doubt, ask what they'd like to do rather than picking a path for them.`
  const docsUrlGuidance = opts.docsUrl
    ? `\n# Electric Agents documentation
- ${opts.hasDocsSupport ? `If search_electric_agents_docs is available, use it first (faster, hybrid search).` : `Use fetch_url to look up documentation pages.`}
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
- fork: spawn a child session that inherits this conversation's history up to the latest completed response. Same parent-ownership model as spawn_worker — when the fork's next run finishes, you'll wake with its response.
- observe_pg_sync: observe an Electric Postgres sync stream and wake on matching changes (see "Observing Postgres tables")
- send: send a message to an Electric Agent/entity. To schedule future work for yourself, call send with self: true and afterMs.
${eventSourceTools}${titleTool}${scheduleTools}${docsTools}${skillsTools}

# Working with files
- Prefer edit over write when modifying existing files.
- You must read a file before you can edit it.
- Use absolute paths or paths relative to the current working directory.
${modelGuidance}${docsGuidance}${skillsGuidance}${onboardingGuidance}${docsUrlGuidance}

# Observing Postgres tables
observe_pg_sync subscribes you to row changes in a Postgres table via an Electric shape stream:
- The \`url\` parameter is the HTTP(S) URL of an Electric shape endpoint (e.g. \`http://localhost:3000/v1/shape\`). It is NOT a \`postgres://\` connection string and there is no default — if the user hasn't given you the endpoint URL, ask for it. Never guess or invent one.
- Registration validates the endpoint by fetching the shape log first. If it fails, the error includes Electric's response or the failure reason — use it to correct the table name, where clause, or URL, or relay it to the user.
- Use \`where\` and \`columns\` to narrow the shape so you only wake on changes you care about; use \`wake.ops\` to filter by operation and \`wake.debounceMs\` to batch bursts.
- The observation persists across wakes — register it once, don't re-register on every wake.

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

# When to fork (vs spawn_worker)
\`fork\` is the **sibling primitive to spawn_worker** — both create a child you own, both report back to you on a future wake. The difference is only in what the child boots with:

- **spawn_worker** → child boots with an **empty context**; you brief it from scratch via a system prompt + initial message. Use when the worker doesn't need to know what we've said so far.
- **fork** → child boots with **a copy of THIS conversation's history** up to your latest completed response. Use when each child needs to know what we've already established (the user's framing, your prior analysis, an earlier decision, the constraints, etc.).

**Trigger pattern: prefer fork when generating multiple variants the user wants to compare.** If the user asks for "three different X" or "two takes on Y" or "evaluate these N approaches" and each variant should reflect the conversation we've had so far, **don't inline the variants in one response** — fork once per variant, send each a tailored follow-up, and synthesize when they report back. Inlining feels faster but the variants end up cross-contaminating in your single response; forks keep them honestly independent. The exception is trivial generation (a list of names, a couple of one-liners) where each variant takes a sentence — there, inline is fine.

Workflow when forking yourself for parallel exploration:
1. **End your current turn first.** The fork's history stops at your *latest completed* run. Anything you say mid-turn is NOT in the fork. If you want your analysis baked into each fork, finish it and end the turn before calling fork.
2. On the next wake, call \`fork\` once per branch with a different \`initialMessage\` per call — that's how the branches diverge from a shared starting point. Each fork is YOUR child, just like a spawned worker, and the server delivers \`initialMessage\` to the fork in the same round-trip, so the fork starts running immediately (no follow-up \`send\` needed). Use the shape \`{ text: "..." }\` for the message so it renders in the chat UI.
3. End your turn. You'll wake automatically when each fork's run finishes (same wake mechanism as spawn_worker); the wake message identifies the fork and includes its response.
4. If you're waiting on multiple forks, don't synthesize on the first wake — quietly end the turn with "got N of M, waiting" until you have what you need to compare.

# Reporting
Report outcomes faithfully. If a command failed, say so with the relevant output. If you didn't run a verification step, say that rather than implying you did. Don't hedge confirmed results with unnecessary disclaimers.

Working directory: ${workingDirectory}
The current year is ${new Date().getFullYear()}.`
}

function getToolName(tool: unknown): string | null {
  if (typeof tool !== `object` || tool === null) return null
  const name = (tool as { name?: unknown }).name
  return typeof name === `string` ? name : null
}

export function createHortonTools(
  sandbox: Sandbox,
  ctx: HandlerContext,
  readSet: Set<string>,
  opts: {
    docsSearchTool?: AgentTool
    modelConfig?: ReturnType<typeof resolveBuiltinModelConfig>
    modelCatalog?: BuiltinModelCatalog
    logPrefix?: string
  } = {}
): Array<AgentTool> {
  return [
    createBashTool(sandbox),
    createReadFileTool(sandbox, readSet),
    createWriteTool(sandbox, readSet),
    createEditTool(sandbox, readSet),
    braveSearchTool,
    ...(opts.modelCatalog && opts.modelConfig
      ? [
          createFetchUrlTool(sandbox, {
            catalog: opts.modelCatalog,
            modelConfig: opts.modelConfig,
            log: (message) => serverLog.info(message),
            logPrefix: opts.logPrefix ?? `[horton]`,
          }),
        ]
      : [createFetchUrlTool(sandbox)]),
    createSpawnWorkerTool(ctx, opts.modelConfig),
    createForkTool(ctx),
    createObservePgSyncTool(ctx),
    createSetTitleTool(ctx),
    createSendTool(ctx.send, { selfEntityUrl: ctx.entityUrl }),
    ...(opts.docsSearchTool ? [opts.docsSearchTool] : []),
  ]
}

function payloadToTitleText(payload: unknown): string {
  if (typeof payload === `string`) return payload
  if (payload == null) return ``
  if (typeof payload === `object`) {
    const record = payload as Record<string, unknown>
    const text = record.text
    if (typeof text === `string`) return text
    const source = record.source
    if (typeof source === `string`) return source
    return JSON.stringify(payload)
  }
  return String(payload)
}

type InboxTitleMessage = {
  key?: unknown
  from?: unknown
  payload: unknown
  _seq?: unknown
}

type TitleAttachment = {
  kind?: unknown
  subject?: unknown
  role?: unknown
  mimeType?: unknown
  filename?: unknown
  id?: unknown
}

function attachmentTitleText(attachment: TitleAttachment): string | null {
  const mimeType =
    typeof attachment.mimeType === `string` ? attachment.mimeType : ``
  const filename =
    typeof attachment.filename === `string` && attachment.filename.trim()
      ? attachment.filename.trim()
      : typeof attachment.id === `string`
        ? attachment.id
        : `attachment`
  const kind = mimeType.startsWith(`image/`) ? `image` : `file`

  return `Attached ${kind}: ${filename}`
}

function attachmentsForInboxMessage(
  ctx: HandlerContext,
  inboxKey: string
): Array<TitleAttachment> {
  const manifests = (
    ctx.db.collections as {
      manifests?: { toArray?: Array<unknown> }
    }
  ).manifests?.toArray
  if (!Array.isArray(manifests)) return []

  return manifests.filter((entry): entry is TitleAttachment => {
    if (!entry || typeof entry !== `object`) return false
    const attachment = entry as TitleAttachment
    if (attachment.kind !== `attachment`) return false
    if (attachment.role !== `input`) return false
    const subject = attachment.subject
    return (
      subject !== null &&
      typeof subject === `object` &&
      !Array.isArray(subject) &&
      (subject as { type?: unknown }).type === `inbox` &&
      (subject as { key?: unknown }).key === inboxKey
    )
  })
}

function messageTitleText(
  ctx: HandlerContext,
  message: InboxTitleMessage
): string {
  const pieces: Array<string> = []
  const text = payloadToTitleText(message.payload).trim()
  if (text) pieces.push(text)

  const key = typeof message.key === `string` ? message.key : null
  const attachments = key ? attachmentsForInboxMessage(ctx, key) : []
  for (const attachment of attachments) {
    const attachmentText = attachmentTitleText(attachment)
    if (attachmentText) pieces.push(attachmentText)
  }

  return pieces.join(`\n`)
}

export async function extractFirstUserMessage(
  ctx: HandlerContext
): Promise<string | null> {
  const firstMessage = (
    ctx.db.collections.inbox.toArray as Array<InboxTitleMessage>
  )
    .filter((message) => message.from !== `system`)
    .sort((left, right) => messageSeq(left) - messageSeq(right))[0]

  if (!firstMessage) return null
  const text = messageTitleText(ctx, firstMessage)
  return text.length > 0 ? text : null
}

function messageSeq(message: { _seq?: unknown }): number {
  return typeof message._seq === `number` ? message._seq : -1
}

type HortonDocsSupport = NonNullable<ReturnType<typeof createHortonDocsSupport>>

async function readAgentsMd(sandbox: Sandbox): Promise<string | null> {
  // Read through the sandbox, not the host fs, so the path and contents match
  // where the agent's tools actually operate — the remote VM's working
  // directory for a remote sandbox, the host project root for a local one.
  const agentsMdPath = path.posix.join(sandbox.workingDirectory, `AGENTS.md`)
  try {
    const content = (await sandbox.readFile(agentsMdPath)).toString(`utf8`)
    return [
      `<context_file kind="instructions" path="${agentsMdPath}">`,
      content,
      `</context_file>`,
    ].join(`\n`)
  } catch {
    // Missing, unreadable, or outside the sandbox's read policy — no context.
    return null
  }
}

function createAssistantHandler(options: {
  streamFn?: StreamFn
  docsSupport: HortonDocsSupport | null
  docsSearchTool?: AgentTool
  skillsRegistry: SkillsRegistry | null
  modelCatalog: BuiltinModelCatalog
  docsUrl?: string
}) {
  const {
    streamFn,
    docsSupport,
    docsSearchTool,
    skillsRegistry,
    modelCatalog,
    docsUrl,
  } = options
  const skillLoader = createContextSkillLoader(skillsRegistry, {
    slashCommandOwner: HORTON_SKILLS_SLASH_COMMAND_OWNER,
  })
  const hasSkills = skillLoader.hasSkills

  return async function assistantHandler(
    ctx: HandlerContext,
    wake: WakeEvent
  ): Promise<void> {
    const loadedSkills = await skillLoader.load(ctx)

    const readSet = new Set<string>()
    const modelConfig = resolveBuiltinModelConfig(modelCatalog, ctx.args)
    const sourceBudget = resolveBuiltinModelSourceBudget(modelConfig)
    // The sandbox's own working directory is the single source of truth for
    // where the agent operates — `/work` in a remote VM, or the host project
    // root for a local sandbox (the local profile derives that from
    // `args.workingDirectory`, so the desktop directory picker still applies).
    // Report it in the prompt and read AGENTS.md from it so the model never
    // sees a host path it can't actually reach.
    const sandboxCwd = ctx.sandbox.workingDirectory
    const agentsMd = await readAgentsMd(ctx.sandbox)
    // `ctx.sandbox` is constructed by the runtime at wake-session
    // start from the profile named on `entity.sandbox.profile` (set at
    // spawn time) and disposed when the wake-session ends.
    const tools = [
      ...ctx.electricTools,
      ...createHortonTools(ctx.sandbox, ctx, readSet, {
        docsSearchTool,
        modelConfig,
        modelCatalog,
        logPrefix: `[horton ${ctx.entityUrl}]`,
      }),
      ...loadedSkills.tools,
      ...mcp.tools(),
    ]
    const hasEventSourceTools = tools.some(
      (tool) => getToolName(tool) === `list_event_sources`
    )
    const hasScheduleTools = tools.some(
      (tool) => getToolName(tool) === `upsert_cron_schedule`
    )

    const titlePromise = !ctx.tags.title
      ? (async () => {
          const firstUserMessage = await extractFirstUserMessage(ctx)
          if (!firstUserMessage) return

          let title: string | null = null
          try {
            const result = await generateTitle(
              firstUserMessage,
              (prompt) =>
                withTimeout(
                  createConfiguredTitleCall(
                    modelCatalog,
                    modelConfig,
                    `[horton ${ctx.entityUrl}]`
                  )(prompt),
                  TITLE_GENERATION_TIMEOUT_MS,
                  `title generation`
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
            title = buildFallbackTitle(firstUserMessage)
          }

          if (title !== null) {
            try {
              await withTimeout(
                ctx.setTag(`title`, title),
                TITLE_GENERATION_TIMEOUT_MS,
                `set title tag`
              )
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
        sourceBudget,
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
            ? loadedSkills.sources
            : {}),
        },
      })
    } else if (skillsRegistry && skillsRegistry.catalog.size > 0) {
      ctx.useContext({
        sourceBudget,
        sources: {
          ...loadedSkills.sources,
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
        sourceBudget,
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
      systemPrompt: buildHortonSystemPrompt(sandboxCwd, {
        hasDocsSupport: Boolean(docsSupport),
        hasSkills,
        docsUrl,
        modelProvider: modelConfig.provider,
        modelId: String(modelConfig.model),
        hasEventSourceTools,
        hasScheduleTools,
      }),
      ...modelConfig,
      // mcp.tools() inserts sentinel objects that the runtime's
      // composeToolsWithProviders resolves at wake time. The static type of
      // useAgent doesn't model this, so cast at the boundary.
      tools: tools as AgentTool[],
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
  } else if (process.env.ANTHROPIC_API_KEY) {
    serverLog.warn(
      `[horton] BRAVE_SEARCH_API_KEY not set — web search will fall back to Anthropic built-in search`
    )
  } else {
    serverLog.warn(
      `[horton] BRAVE_SEARCH_API_KEY and ANTHROPIC_API_KEY not set — web search tool will be unavailable`
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
    streamFn,
    docsSupport,
    docsSearchTool,
    skillsRegistry,
    modelCatalog,
    docsUrl,
  })

  const hortonCreationSchema = z
    .object({
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
    .meta({
      $defs: modelInputSchemaDefs(modelCatalog),
    })

  registry.define(`horton`, {
    description: `Friendly capable assistant — chat, code, research, dispatch`,
    creationSchema: hortonCreationSchema,
    permissionGrants: [
      {
        subject_kind: `principal_kind`,
        subject_value: `user`,
        permission: `spawn`,
      },
      {
        subject_kind: `principal_kind`,
        subject_value: `user`,
        permission: `manage`,
      },
    ],
    slashCommands: buildSkillSlashCommands(skillsRegistry),
    handler: assistantHandler,
  })

  return [`horton`]
}
