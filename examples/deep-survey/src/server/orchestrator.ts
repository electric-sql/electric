import type {
  EntityRegistry,
  HandlerContext,
  SharedStateHandle,
} from '@electric-ax/agents-runtime'
import { db } from '@electric-ax/agents-runtime'
import { queryOnce } from '@durable-streams/state'
import { Type } from '@sinclair/typebox'
import { exec, execFile } from 'node:child_process'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import { swarmSharedSchema, type WikiEntry, type Xref } from './schema.js'
import { explorerSpawnArgs } from './explorer.js'
import { SURVEY_WORKER_ENTITY_TYPE } from './survey-worker.js'
import { createSharedWikiTools, createWebSearchTool } from './shared-tools.js'
import { orchestratorModelConfig } from './model-config.js'

type SwarmSharedState = SharedStateHandle<typeof swarmSharedSchema>

const ORCHESTRATOR_SYSTEM_PROMPT = `You are the orchestrator of a deep survey. You coordinate dozens of explorer agents that analyze a target corpus in parallel.

Rules:
1. When the user gives you a target to explore, first use web_search to do initial research and understand the landscape — what are the major subsystems, modules, or topic areas? For code repos, use clone_repo to clone the repository first, then research its structure.
2. Once you understand the topic space, call explore_corpus to break it into topics and spawn explorer agents. Each explorer will do its own web research and write wiki entries.
3. explore_corpus can only be called once per swarm. After explorers exist, do not call it again.
4. If the user asks a question about the corpus, call query_wiki to search the accumulated knowledge base.
5. If the user asks for status, call get_swarm_status.
6. When you receive WAKE EVENTs (JSON payloads with finished_child), these are internal progress signals. Give concise updates about how many explorers have finished.
7. Do not say the swarm is complete unless all explorers have finished (check via get_swarm_status or wake data showing no running children).
8. You also have write_wiki, read_wiki, and write_xrefs. Use them to inspect or correct the shared knowledge base when useful.
9. When answering questions, synthesize information from multiple wiki entries and note which cross-references connect them.
`

const VALID_REPO_URL = /^https?:\/\/[a-zA-Z0-9._\-]+\/[a-zA-Z0-9._\-/]+$/

function createCloneRepoTool(): AgentTool {
  return {
    name: `clone_repo`,
    label: `Clone Repository`,
    description: `Clone a git repository to /tmp for exploration. Returns the local path. Use this for code corpus exploration.`,
    parameters: Type.Object({
      url: Type.String({
        description: `Git repository URL (e.g. https://github.com/org/repo)`,
      }),
    }),
    execute: async (_toolCallId, params) => {
      const { url } = params as { url: string }
      if (!VALID_REPO_URL.test(url)) {
        return {
          content: [
            { type: `text` as const, text: `Invalid repository URL: ${url}` },
          ],
          details: {},
        }
      }
      const repoName =
        url
          .split(`/`)
          .pop()
          ?.replace(/\.git$/, ``) ?? `repo`
      const dest = `/tmp/swarm-repos/${repoName}`
      return new Promise((resolve) => {
        execFile(
          `git`,
          [`clone`, `--depth`, `1`, url, dest],
          { timeout: 60_000 },
          (err) => {
            if (err) {
              resolve({
                content: [
                  {
                    type: `text` as const,
                    text: `Clone failed: ${err.message}`,
                  },
                ],
                details: {},
              })
              return
            }
            exec(
              `find ${dest} -type f \\( -name '*.ts' -o -name '*.js' -o -name '*.py' -o -name '*.go' -o -name '*.rs' -o -name '*.java' \\) | head -50`,
              (_, stdout) => {
                resolve({
                  content: [
                    {
                      type: `text` as const,
                      text: `Cloned to ${dest}\n\nSample files:\n${stdout ?? ``}`,
                    },
                  ],
                  details: { path: dest },
                })
              }
            )
          }
        )
      })
    },
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, `-`)
    .replace(/^-+|-+$/g, ``)
}

function readWiki(shared: SwarmSharedState): WikiEntry[] {
  return shared.wiki.toArray as WikiEntry[]
}

function readXrefs(shared: SwarmSharedState): Xref[] {
  return shared.xrefs.toArray as Xref[]
}

function createExploreCorpusTool(
  ctx: HandlerContext,
  sharedStateId: string
): AgentTool {
  return {
    name: `explore_corpus`,
    label: `Explore Corpus`,
    description: `Break the target corpus into topics and spawn one explorer agent per topic. Can only be called once.`,
    parameters: Type.Object({
      corpus: Type.String({
        description: `Description of the target corpus to explore (e.g., "React source code" or "YC W25 batch").`,
      }),
      topics: Type.Array(
        Type.String({
          description: `A specific topic or module within the corpus for one explorer to analyze.`,
        }),
        {
          minItems: 5,
          maxItems: 60,
          description: `List of topics to explore. Each becomes one explorer agent.`,
        }
      ),
    }),
    execute: async (_toolCallId, params) => {
      const { corpus, topics } = params as {
        corpus: string
        topics: string[]
      }

      const existing = await queryOnce((q) =>
        q.from({ manifests: ctx.db.collections.manifests })
      )
      const hasChildren = existing.some(
        (m) => m.kind === `child` && m.entity_type === SURVEY_WORKER_ENTITY_TYPE
      )
      if (hasChildren) {
        throw new Error(
          `Explorers already spawned. Use query_wiki to search the knowledge base.`
        )
      }

      const childUrls: string[] = []
      const swarmId = ctx.entityUrl.split(`/`).pop() ?? `swarm`

      for (const topic of topics) {
        const childId = `${swarmId}-${slugify(topic)}`
        const args = explorerSpawnArgs(topic, corpus, sharedStateId, childId)

        await ctx.spawn(SURVEY_WORKER_ENTITY_TYPE, childId, args, {
          initialMessage: `Explore your assigned topic and write a wiki entry.`,
          wake: `runFinished`,
          tags: {
            swarm_id: swarmId,
            topic: topic.slice(0, 50),
          },
        })

        childUrls.push(`/${SURVEY_WORKER_ENTITY_TYPE}/${childId}`)
      }

      return {
        content: [
          {
            type: `text` as const,
            text:
              `Spawned ${topics.length} explorer agents for "${corpus}". ` +
              `Topics: ${topics.join(`, `)}. ` +
              `Wiki entries and cross-references will accumulate in shared state.`,
          },
        ],
        details: { corpus, topicCount: topics.length, childUrls },
      }
    },
  }
}

function createQueryWikiTool(shared: SwarmSharedState): AgentTool {
  return {
    name: `query_wiki`,
    label: `Query Wiki`,
    description: `Search the accumulated wiki entries and cross-references.`,
    parameters: Type.Object({
      question: Type.String({
        description: `The question to search for in the wiki.`,
      }),
    }),
    execute: async (_toolCallId, params) => {
      const { question } = params as { question: string }
      const entries = readWiki(shared)
      const xrefs = readXrefs(shared)

      if (entries.length === 0) {
        return {
          content: [
            {
              type: `text` as const,
              text: `No wiki entries yet. Explorers may still be working.`,
            },
          ],
          details: { entryCount: 0 },
        }
      }

      const lower = question.toLowerCase()
      const relevant = entries.filter(
        (e) =>
          e.title.toLowerCase().includes(lower) ||
          e.body.toLowerCase().includes(lower) ||
          e.key.toLowerCase().includes(lower)
      )
      const results = relevant.length > 0 ? relevant : entries

      const resultKeys = new Set(results.map((r) => r.key))
      const relatedXrefs = xrefs.filter(
        (x) => resultKeys.has(x.a) || resultKeys.has(x.b)
      )

      const formatted = [
        `## Wiki Query: "${question}"`,
        ``,
        `**${results.length} entries** (${entries.length} total, ${xrefs.length} cross-refs)`,
        ``,
        ...results.map(
          (e) =>
            `### ${e.title}\n*Key: ${e.key} · Author: ${e.author}*\n\n${e.body}`
        ),
        ``,
        `### Cross-references`,
        ...relatedXrefs.map((x) => `- ${x.a} ↔ ${x.b}`),
      ].join(`\n`)

      return {
        content: [{ type: `text` as const, text: formatted }],
        details: {
          question,
          totalEntries: entries.length,
          returnedEntries: results.length,
          totalXrefs: xrefs.length,
        },
      }
    },
  }
}

function createSwarmStatusTool(
  ctx: HandlerContext,
  shared: SwarmSharedState
): AgentTool {
  return {
    name: `get_swarm_status`,
    label: `Get Swarm Status`,
    description: `Reports wiki/xref counts AND child explorer completion status.`,
    parameters: Type.Object({}),
    execute: async () => {
      const entries = readWiki(shared)
      const xrefs = readXrefs(shared)

      const children = await queryOnce((q) =>
        q.from({ cs: ctx.db.collections.childStatus })
      )
      const byStatus = { spawning: 0, running: 0, idle: 0, stopped: 0 }
      for (const c of children) {
        const s = (c as any).status as string
        if (s in byStatus) byStatus[s as keyof typeof byStatus]++
      }
      const total = children.length
      const finished = byStatus.idle + byStatus.stopped
      const allDone = total > 0 && finished === total

      return {
        content: [
          {
            type: `text` as const,
            text:
              `Wiki: ${entries.length} entries. ` +
              `Cross-refs: ${xrefs.length} edges. ` +
              `Explorers: ${total} total — ${byStatus.running} running, ${byStatus.idle} idle, ${byStatus.stopped} stopped. ` +
              (allDone
                ? `ALL EXPLORERS FINISHED.`
                : `${finished}/${total} complete.`) +
              ` Titles: ${entries.map((e) => e.title).join(`, `) || `(none yet)`}.`,
          },
        ],
        details: {
          entryCount: entries.length,
          xrefCount: xrefs.length,
          childStatus: byStatus,
          allDone,
          titles: entries.map((e) => e.title),
        },
      }
    },
  }
}

export function registerOrchestrator(registry: EntityRegistry) {
  registry.define(`orchestrator`, {
    description: `Deep survey coordinator — spawns explorer agents, tracks wiki progress, answers questions`,

    async handler(ctx) {
      const entityId = ctx.entityUrl.split(`/`).pop() ?? `swarm`
      const sharedStateId = `wiki-swarm-${entityId}`

      if (ctx.firstWake) {
        ctx.mkdb(sharedStateId, swarmSharedSchema)
      }

      const shared = (await ctx.observe(
        db(sharedStateId, swarmSharedSchema)
      )) as unknown as SwarmSharedState

      ctx.useAgent({
        systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
        ...orchestratorModelConfig(),
        tools: [
          ...ctx.electricTools,
          createWebSearchTool(),
          createCloneRepoTool(),
          createExploreCorpusTool(ctx, sharedStateId),
          ...createSharedWikiTools(shared),
          createQueryWikiTool(shared),
          createSwarmStatusTool(ctx, shared),
        ],
      })
      await ctx.agent.run()
    },
  })
}
