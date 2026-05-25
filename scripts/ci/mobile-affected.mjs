#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { relative, sep } from 'node:path'

const repoRoot = execFileSync(`git`, [`rev-parse`, `--show-toplevel`], {
  encoding: `utf8`,
}).trim()
const baseRef = process.env.BASE_SHA || process.env.GITHUB_BASE_REF || `HEAD~1`
const mobilePackage = `@electric-ax/agents-mobile`

const globalChangePatterns = [
  `.github/workflows/agents_mobile_*.yml`,
  `.npmrc`,
  `.tool-versions`,
  `package.json`,
  `patches/**`,
  `pnpm-lock.yaml`,
  `pnpm-workspace.yaml`,
  `tsconfig.base.json`,
  `tsconfig.build.json`,
]

const changedFiles = getChangedFiles(baseRef)
const globalChange = shouldRunForGlobalChange(baseRef, changedFiles)
const mobileClosure = listWorkspaces([`${mobilePackage}...`])
const changedClosure = globalChange ? [] : listWorkspaces([`...[${baseRef}]`])
const mobileClosureNames = new Set(
  mobileClosure.map((workspace) => workspace.name)
)
const affectedWorkspaces = globalChange
  ? mobileClosure
  : changedClosure.filter((workspace) => mobileClosureNames.has(workspace.name))
const shouldBuild = globalChange || affectedWorkspaces.length > 0

const outputs = {
  should_build: String(shouldBuild),
  affected_workspaces: JSON.stringify(
    affectedWorkspaces.map((workspace) => workspace.relativePath).sort()
  ),
  reason: globalChange
    ? `global mobile build input changed`
    : shouldBuild
      ? `mobile package or dependency changed`
      : `no mobile package dependency changed`,
}

writeOutputs(outputs)

console.log(
  JSON.stringify(
    {
      baseRef,
      changedFiles,
      mobileClosure: mobileClosure.map((workspace) => workspace.relativePath),
      ...outputs,
    },
    null,
    2
  )
)

function listWorkspaces(filters) {
  const args = [`-r`, `list`, `--depth`, `-1`, `--json`]
  for (const filter of filters) {
    args.push(`--filter`, filter)
  }

  try {
    return parsePnpmList(run(`pnpm`, args))
  } catch (error) {
    console.warn(
      `Falling back to building mobile because pnpm filtering failed.`
    )
    console.warn(error.message)
    return [{ name: mobilePackage, relativePath: `packages/agents-mobile` }]
  }
}

function parsePnpmList(output) {
  return JSON.parse(output).map((workspace) => ({
    ...workspace,
    relativePath: toPosixPath(relative(repoRoot, workspace.path)),
  }))
}

function getChangedFiles(base) {
  if (!base || /^0+$/.test(base)) {
    return []
  }

  try {
    run(`git`, [`rev-parse`, `--verify`, `${base}^{commit}`])
    return run(`git`, [`diff`, `--name-only`, base, `--`, `.`])
      .split(`\n`)
      .map((file) => file.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function shouldRunForGlobalChange(base, files) {
  if (!base || /^0+$/.test(base) || files.length === 0) {
    return true
  }

  return files.some((file) =>
    globalChangePatterns.some((pattern) => matchesPattern(file, pattern))
  )
}

function matchesPattern(file, pattern) {
  if (pattern.endsWith(`/**`)) {
    return file.startsWith(pattern.slice(0, -3))
  }

  if (pattern.includes(`*`)) {
    const escaped = pattern
      .split(`*`)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`))
      .join(`.*`)
    return new RegExp(`^${escaped}$`).test(file)
  }

  return file === pattern
}

function writeOutputs(outputs) {
  const outputFile = process.env.GITHUB_OUTPUT
  if (!outputFile) {
    return
  }

  appendFileSync(
    outputFile,
    Object.entries(outputs)
      .map(([key, value]) => `${key}=${value}`)
      .join(`\n`) + `\n`
  )
}

function run(command, args) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: `utf8`,
    stdio: [`ignore`, `pipe`, `pipe`],
  })
}

function toPosixPath(value) {
  return value.split(sep).join(`/`)
}
