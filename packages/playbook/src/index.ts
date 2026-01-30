/**
 * @electric-sql/agent
 *
 * Agent skills for building apps with Electric.
 * This package provides AI agent skills that help coding assistants
 * build local-first applications with Electric and TanStack DB.
 */

export const SKILLS = [
  `electric`,
  `electric-quickstart`,
  `electric-tanstack-integration`,
  `electric-security-check`,
  `electric-go-live`,
  `deploying-electric`,
] as const

export type SkillName = (typeof SKILLS)[number]

export const AGENT_SKILL_DIRS = [
  `.claude/skills`, // Claude Code
  `.cursor/skills`, // Cursor
  `.codex/skills`, // OpenAI Codex
  `.github/skills`, // GitHub Copilot
  `.windsurf/skills`, // Windsurf
] as const

export type AgentDir = (typeof AGENT_SKILL_DIRS)[number]
