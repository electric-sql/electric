import { createSkillTools, loadSkillIntoContext } from './tools'
import type { SkillsRegistry } from './types'
import {
  COMPOSER_INPUT_MESSAGE_TYPE,
  firstSlashCommand,
  textAfterNode,
  type WireComposerInputPayload,
} from '../composer-input'
import type { AgentTool, HandlerContext, SourceConfig } from '../types'
import type { SlashCommandDefinition } from '../composer-input'

const DEFAULT_SLASH_COMMAND_OWNER = `skills`
const DEFAULT_CATALOG_SOURCE_NAME = `skills_catalog`
const DEFAULT_CATALOG_BUDGET = 2_000

const SLASH_COMMAND_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const SLASH_COMMAND_ARGUMENT_NAME_PATTERN = /^[a-z][a-zA-Z0-9_]*$/

export interface ContextSkillLoaderOptions {
  slashCommandOwner?: string
  catalogSourceName?: string
  catalogBudget?: number
}

export interface LoadedSkillContext {
  tools: Array<AgentTool>
  sources: Record<string, SourceConfig>
  autoLoadedSkills: Array<string>
}

export interface ContextSkillLoader {
  hasSkills: boolean
  load: (
    ctx: Pick<
      HandlerContext,
      | `wake`
      | `slashCommands`
      | `insertContext`
      | `removeContext`
      | `getContext`
    >
  ) => Promise<LoadedSkillContext>
}

export function buildSkillSlashCommands(
  registry: SkillsRegistry | null | undefined
): Array<SlashCommandDefinition> {
  if (!registry) {
    return []
  }

  return Array.from(registry.catalog.values())
    .filter(
      (skill) =>
        skill.userInvocable && SLASH_COMMAND_NAME_PATTERN.test(skill.name)
    )
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((skill) => ({
      name: skill.name,
      description: skill.description,
      ...(skill.arguments && skill.arguments.length > 0
        ? {
            arguments: skill.arguments
              .filter((name) => SLASH_COMMAND_ARGUMENT_NAME_PATTERN.test(name))
              .map((name) => ({
                name,
                type: `string` as const,
                required: false,
                ...(skill.argumentHint
                  ? { description: skill.argumentHint }
                  : {}),
              })),
          }
        : {}),
    }))
}

export function createContextSkillLoader(
  registry: SkillsRegistry | null | undefined,
  opts: ContextSkillLoaderOptions = {}
): ContextSkillLoader {
  const slashCommandOwner =
    opts.slashCommandOwner ?? DEFAULT_SLASH_COMMAND_OWNER
  const catalogSourceName =
    opts.catalogSourceName ?? DEFAULT_CATALOG_SOURCE_NAME
  const catalogBudget = opts.catalogBudget ?? DEFAULT_CATALOG_BUDGET
  const hasSkills = Boolean(registry && registry.catalog.size > 0)

  return {
    hasSkills,
    async load(ctx) {
      ctx.slashCommands.replaceOwned(
        slashCommandOwner,
        buildSkillSlashCommands(registry)
      )

      if (!registry || registry.catalog.size === 0) {
        return { tools: [], sources: {}, autoLoadedSkills: [] }
      }

      const autoLoadedSources: Record<string, SourceConfig> = {}
      const autoLoadedSkills: Array<string> = []
      const composerCommand = firstComposerSlashCommand(ctx.wake)
      const command = composerCommand?.command
      const skill =
        command && registry.catalog.get(command.name)?.userInvocable
          ? registry.catalog.get(command.name)
          : undefined

      if (composerCommand && command && skill) {
        const args = textAfterNode(composerCommand.payload, command).trim()
        const result = await loadSkillIntoContext(
          registry,
          ctx,
          command.name,
          args || undefined
        )
        if (result.contextSource) {
          autoLoadedSkills.push(command.name)
          autoLoadedSources[`skill:${command.name}`] = {
            content: () => result.contextSource!,
            max: result.contextSource.length,
            cache: `volatile`,
          }
        }
      }

      return {
        tools: createSkillTools(registry, ctx),
        sources: {
          [catalogSourceName]: {
            content: () => registry.renderCatalog(catalogBudget),
            max: catalogBudget,
            cache: `stable`,
          },
          ...autoLoadedSources,
        },
        autoLoadedSkills,
      }
    },
  }
}

function firstComposerSlashCommand(wake: Pick<HandlerContext, `wake`>[`wake`]) {
  if (wake.type !== `inbox`) {
    return undefined
  }
  if (wake.message.type !== COMPOSER_INPUT_MESSAGE_TYPE) {
    return undefined
  }
  const payload = wake.message.payload
  if (
    typeof payload !== `object` ||
    payload === null ||
    typeof (payload as { source?: unknown }).source !== `string`
  ) {
    return undefined
  }
  const composerPayload = payload as WireComposerInputPayload
  const command = firstSlashCommand(composerPayload)
  return command ? { command, payload: composerPayload } : undefined
}
