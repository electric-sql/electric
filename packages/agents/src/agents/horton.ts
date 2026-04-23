import Anthropic from '@anthropic-ai/sdk'
import { serverLog } from '../log'
import { createHortonDocsSupport } from '../docs/knowledge-base'
import { createSkillTools } from '../skills/tools'
import { createBashTool } from '../tools/bash'
import { createEditTool } from '../tools/edit'
import { fetchUrlTool } from '../tools/fetch-url'
import { createReadFileTool } from '../tools/read-file'
import { createSpawnWorkerTool } from '../tools/spawn-worker'
import { createWriteTool } from '../tools/write'
import { braveSearchTool } from '../tools/brave-search'
import type { AgentTool, StreamFn } from '@mariozechner/pi-agent-core'
import type {
  EntityRegistry,
  HandlerContext,
  WakeEvent,
} from '@electric-ax/agents-runtime'
import type { ChangeEvent } from '@durable-streams/state'
import type { SkillsRegistry } from '../skills/types'

const TITLE_MODEL = `claude-haiku-4-5-20251001`

export const HORTON_MODEL = `claude-sonnet-4-5-20250929`

let anthropic: Anthropic | null = null
function getClient(): Anthropic {
  if (!anthropic) {
    anthropic = new Anthropic()
  }
  return anthropic
}

async function defaultHaikuCall(prompt: string): Promise<string> {
  const client = getClient()
  const res = await client.messages.create({
    model: TITLE_MODEL,
    max_tokens: 64,
    messages: [{ role: `user`, content: prompt }],
  })
  const block = res.content[0]
  return block?.type === `text` ? block.text : ``
}

const TITLE_PROMPT = (userMessage: string): string =>
  `Summarize the following user request in 3-5 words for use as a chat session title.
Respond with only the title, no quotes, no punctuation, no preamble.

User request:
${userMessage}`

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

export async function generateTitle(
  userMessage: string,
  llmCall: (prompt: string) => Promise<string> = defaultHaikuCall
): Promise<string> {
  try {
    const raw = await llmCall(TITLE_PROMPT(userMessage))
    const title = raw.trim()
    return title.length > 0 ? title : buildFallbackTitle(userMessage)
  } catch {
    return buildFallbackTitle(userMessage)
  }
}

export function buildHortonSystemPrompt(
  workingDirectory: string,
  opts: { hasDocsSupport?: boolean; hasSkills?: boolean } = {}
): string {
  const docsTools = opts.hasDocsSupport
    ? `\n- search_durable_agents_docs: hybrid search over the built-in Durable Agents docs index`
    : ``
  const skillsTools = opts.hasSkills
    ? `\n- use_skill: load a skill (knowledge, instructions, or a tutorial) into your context to help with the user's request\n- remove_skill: unload a skill from context when you're done with it`
    : ``
  const docsGuidance = opts.hasDocsSupport
    ? `\n- You have built-in Durable Agents docs context plus a docs search tool. Use that before broad web search when the question is about this repo, Electric Agents, or Durable Agents.\n- The docs TOC and docs search results include concrete file paths under the docs tree. Use the normal read tool with those returned paths.\n- Use repo read/bash tools for non-doc files or when you need to inspect exact implementation code in the workspace.`
    : ``
  const skillsGuidance = opts.hasSkills
    ? `\n# Skills\nYou have access to skills — specialized knowledge and guided workflows you can load on demand. Your context includes a skills catalog listing what's available. When the user's request matches a skill's description or keywords, load it with use_skill.

Some skills are user-invocable — the user can trigger them with a slash command like \`/tutorial\`. When you see a message starting with \`/\` followed by a skill name, load that skill immediately with use_skill. Pass any text after the skill name as args.

## IMPORTANT: How to use a loaded skill

When you load a skill, it becomes your primary directive for that interaction. Follow the skill's instructions exactly:

1. **Read all reference files first.** The use_skill tool response lists reference files with absolute paths. Read ALL of them with your read tool before responding to the user. These files contain the actual content the skill needs — without them you're guessing.
2. **Follow the skill's conversation flow.** If the skill defines steps, follow them in order. Do not improvise your own approach.
3. **Adopt the skill's persona and teaching style.** The skill defines how to interact — follow it.
4. **Unload when done.** Use remove_skill to free context space when the skill's workflow is complete.

Do NOT load a skill and then ignore its instructions. The skill is there because it contains a tested, specific workflow. Your job is to execute it faithfully.`
    : ``
  return `You are Horton, a friendly and capable assistant. You can chat, research the web, read and edit code, run shell commands, and dispatch subagents (workers) for isolated subtasks. Be warm and engaging in conversation; be precise and concrete when working with code.

# Tools
- bash: run shell commands
- read: read a file
- write: create or overwrite a file
- edit: targeted string replacement in an existing file (you must read the file first)
- brave_search: search the web
- fetch_url: fetch and convert a URL to markdown
- spawn_worker: dispatch a subagent for an isolated task
${docsTools}${skillsTools}

# Working with files
- Prefer edit over write when modifying existing files.
- You must read a file before you can edit it.
- Use absolute paths or paths relative to the current working directory.
${docsGuidance}${skillsGuidance}

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
  opts: { docsSearchTool?: AgentTool } = {}
): Array<AgentTool> {
  return [
    createBashTool(workingDirectory),
    createReadFileTool(workingDirectory, readSet),
    createWriteTool(workingDirectory, readSet),
    createEditTool(workingDirectory, readSet),
    braveSearchTool,
    fetchUrlTool,
    createSpawnWorkerTool(ctx),
    ...(opts.docsSearchTool ? [opts.docsSearchTool] : []),
  ]
}

export function extractFirstUserMessage(
  events: Array<ChangeEvent>
): string | null {
  for (const event of events) {
    if (event.type !== `message_received`) continue
    const value = event.value as
      | { from?: string; payload?: unknown }
      | undefined
    if (!value || value.from === `system`) continue
    const payload = value.payload
    if (typeof payload === `string`) return payload
    if (payload != null) return JSON.stringify(payload)
  }
  return null
}

type HortonDocsSupport = NonNullable<ReturnType<typeof createHortonDocsSupport>>

function createAssistantHandler(options: {
  workingDirectory: string
  streamFn?: StreamFn
  docsSupport: HortonDocsSupport | null
  docsSearchTool?: AgentTool
  skillsRegistry: SkillsRegistry | null
}) {
  const {
    workingDirectory,
    streamFn,
    docsSupport,
    docsSearchTool,
    skillsRegistry,
  } = options
  const hasSkills = Boolean(skillsRegistry && skillsRegistry.catalog.size > 0)

  return async function assistantHandler(
    ctx: HandlerContext,
    wake: WakeEvent
  ): Promise<void> {
    const readSet = new Set<string>()
    const tools = [
      ...ctx.electricTools,
      ...createHortonTools(workingDirectory, ctx, readSet, { docsSearchTool }),
      ...(skillsRegistry && skillsRegistry.catalog.size > 0
        ? createSkillTools(skillsRegistry, ctx)
        : []),
    ]

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
        },
      })
    }

    ctx.useAgent({
      systemPrompt: buildHortonSystemPrompt(workingDirectory, {
        hasDocsSupport: Boolean(docsSupport),
        hasSkills,
      }),
      model: HORTON_MODEL,
      tools,
      ...(streamFn && { streamFn }),
    })
    await ctx.agent.run()

    if (ctx.firstWake && !ctx.tags.title) {
      const firstUserMessage = extractFirstUserMessage(ctx.events)
      if (firstUserMessage) {
        let title: string | null = null
        try {
          const result = await generateTitle(firstUserMessage)
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
      }
    }
  }
}

export function registerHorton(
  registry: EntityRegistry,
  options: {
    workingDirectory: string
    streamFn?: StreamFn
    skillsRegistry?: SkillsRegistry | null
  }
): Array<string> {
  const { workingDirectory, streamFn, skillsRegistry = null } = options
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
  })

  registry.define(`horton`, {
    description: `Friendly capable assistant — chat, code, research, dispatch`,
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
