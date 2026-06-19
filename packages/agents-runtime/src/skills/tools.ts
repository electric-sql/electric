import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { Type } from '@sinclair/typebox'
import type { AgentTool, HandlerContext } from '../types'
import type { SkillsRegistry } from './types'

function skillContextId(name: string): string {
  return `skill:${name}`
}

export interface LoadSkillResult {
  loaded: boolean
  alreadyLoaded?: boolean
  chars?: number
  message: string
  contextSource?: string
}

export async function loadSkillIntoContext(
  registry: SkillsRegistry,
  ctx: Pick<HandlerContext, `insertContext` | `getContext`>,
  name: string,
  args?: string
): Promise<LoadSkillResult> {
  const meta = registry.catalog.get(name)
  if (!meta) {
    const available = Array.from(registry.catalog.keys()).join(`, `)
    return {
      loaded: false,
      message: `Skill "${name}" not found. Available skills: ${available || `none`}`,
    }
  }

  const contextId = skillContextId(name)
  if (ctx.getContext(contextId)) {
    return {
      loaded: false,
      alreadyLoaded: true,
      message: `Skill "${name}" is already loaded.`,
    }
  }

  let content = await registry.readContent(name)
  if (content === null) {
    return {
      loaded: false,
      message: `Error: could not read skill file for "${name}".`,
    }
  }

  if (args) {
    content = substituteArgs(content, args, meta.arguments)
  }

  ctx.insertContext(contextId, {
    name: `skill_instructions`,
    attrs: { skill: name, type: `directive` },
    content,
  })

  const skillDir = path.join(path.dirname(meta.source), name)

  const allRefFiles = listRefFiles(skillDir)
  const mdFiles = allRefFiles.filter((f) => f.endsWith(`.md`))
  const refContents: Array<string> = []
  for (const f of mdFiles) {
    try {
      const refContent = await fsPromises.readFile(
        path.join(skillDir, f),
        `utf-8`
      )
      const refId = `${skillContextId(name)}:${f}`
      ctx.insertContext(refId, {
        name: `skill_reference`,
        attrs: { skill: name, file: f },
        content: refContent,
      })
      refContents.push(`--- ${f} ---\n${refContent}`)
    } catch {
      // skip unreadable files
    }
  }

  const hasRefDir = allRefFiles.length > 0
  const dirNote = hasRefDir ? `\nSkill directory: ${skillDir}` : ``
  const refSection =
    refContents.length > 0 ? `\n\n${refContents.join(`\n\n`)}` : ``
  const contextSource = `SKILL ACTIVATED: "${name}". The instructions below override your default behavior. Follow them exactly. Do not read any files to find this content — it is all here.\n${dirNote}\n\n${content}${refSection}`

  return {
    loaded: true,
    chars: content.length,
    message: contextSource,
    contextSource,
  }
}

export function createSkillTools(
  registry: SkillsRegistry,
  ctx: Pick<HandlerContext, `insertContext` | `removeContext` | `getContext`>
): Array<AgentTool> {
  const useSkill: AgentTool = {
    name: `use_skill`,
    label: `Use Skill`,
    description: `Load a skill into your context. Call with a skill name to load it. Pass args if the skill accepts arguments.`,
    parameters: Type.Object({
      name: Type.String({
        description: `Name of the skill to load`,
      }),
      args: Type.Optional(
        Type.String({
          description: `Arguments to pass to the skill (space-separated, or quoted for multi-word values)`,
        })
      ),
    }),
    execute: async (_toolCallId, params) => {
      const { name, args } = params as { name: string; args?: string }
      const result = await loadSkillIntoContext(registry, ctx, name, args)

      return {
        content: [{ type: `text` as const, text: result.message }],
        details: {
          loaded: result.loaded,
          ...(result.alreadyLoaded
            ? { alreadyLoaded: result.alreadyLoaded }
            : {}),
          ...(result.chars !== undefined ? { chars: result.chars } : {}),
        },
      }
    },
  }

  const removeSkill: AgentTool = {
    name: `remove_skill`,
    label: `Remove Skill`,
    description: `Unload a previously loaded skill from your context.`,
    parameters: Type.Object({
      name: Type.String({
        description: `Name of the skill to remove`,
      }),
    }),
    execute: async (_toolCallId, params) => {
      const { name } = params as { name: string }
      ctx.removeContext(skillContextId(name))

      // Also remove any loaded reference file contexts
      const meta = registry.catalog.get(name)
      if (meta) {
        const skillDir = path.join(path.dirname(meta.source), name)
        for (const f of listRefFiles(skillDir)) {
          ctx.removeContext(`${skillContextId(name)}:${f}`)
        }
      }

      return {
        content: [
          {
            type: `text` as const,
            text: `Skill "${name}" removed from context.`,
          },
        ],
        details: { removed: true },
      }
    },
  }

  return [useSkill, removeSkill]
}

function parseArgs(raw: string): Array<string> {
  const args: Array<string> = []
  let current = ``
  let inQuote = false
  let quoteChar = ``
  for (const ch of raw) {
    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false
      } else {
        current += ch
      }
    } else if (ch === `"` || ch === `'`) {
      inQuote = true
      quoteChar = ch
    } else if (ch === ` ` || ch === `\t`) {
      if (current.length > 0) {
        args.push(current)
        current = ``
      }
    } else {
      current += ch
    }
  }
  if (current.length > 0) args.push(current)
  return args
}

function substituteArgs(
  content: string,
  rawArgs: string,
  argNames?: Array<string>
): string {
  const parsed = parseArgs(rawArgs)
  let result = content
  let matched = false

  // Named arguments: $arg_name → value (by position in argNames)
  if (argNames) {
    for (let i = 0; i < argNames.length && i < parsed.length; i++) {
      const pattern = new RegExp(`\\$${argNames[i]!}\\b`, `g`)
      if (pattern.test(result)) {
        result = result.replace(pattern, parsed[i]!)
        matched = true
      }
    }
  }

  // Indexed: $0, $1, ...
  for (let i = 0; i < parsed.length; i++) {
    const pattern = new RegExp(`\\$${i}\\b`, `g`)
    if (pattern.test(result)) {
      result = result.replace(pattern, parsed[i]!)
      matched = true
    }
  }

  // Full string: $ARGUMENTS
  if (result.includes(`$ARGUMENTS`)) {
    result = result.replace(/\$ARGUMENTS/g, rawArgs)
    matched = true
  }

  // Fallback: append if no placeholders matched
  if (!matched) {
    result += `\n\nArguments: ${rawArgs}`
  }

  return result
}

function listRefFiles(dir: string, prefix = ``): Array<string> {
  try {
    const results: Array<string> = []
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry)
      const rel = prefix ? `${prefix}/${entry}` : entry
      if (fs.statSync(full).isDirectory()) {
        results.push(...listRefFiles(full, rel))
      } else {
        results.push(rel)
      }
    }
    return results
  } catch {
    return []
  }
}
