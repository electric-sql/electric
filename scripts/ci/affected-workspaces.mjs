#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync } from 'node:fs'
import { relative, sep } from 'node:path'

const repoRoot = execFileSync(`git`, [`rev-parse`, `--show-toplevel`], {
  encoding: `utf8`,
}).trim()
const baseRef = process.env.BASE_SHA || process.env.GITHUB_BASE_REF || `HEAD~1`

const globalChangePatterns = [
  `.github/workflows/ensure_sync_service_image.yml`,
  `.github/workflows/ts_tests.yml`,
  `.npmrc`,
  `.tool-versions`,
  `package.json`,
  `packages/electric-telemetry/**`,
  `packages/sync-service/**`,
  `patches/**`,
  `pnpm-lock.yaml`,
  `pnpm-workspace.yaml`,
  `scripts/**`,
  `tsconfig.base.json`,
  `tsconfig.build.json`,
]

const packagesThatNeedSharedSyncService = new Set([
  `packages/experimental`,
  `packages/react-hooks`,
  `packages/typescript-client`,
])

const allWorkspaces = listWorkspaces()
const changedFiles = getChangedFiles(baseRef)
const shouldRunAll = shouldRunAllWorkspaces(baseRef, changedFiles)
const affectedWorkspaces = shouldRunAll
  ? allWorkspaces
  : listAffectedWorkspaces(baseRef)

const packageDirectories = directoriesFor(affectedWorkspaces, isTsPackage)
const packagesWithSharedSyncService = packageDirectories.filter((directory) =>
  packagesThatNeedSharedSyncService.has(directory)
)
const packagesWithoutSharedSyncService = packageDirectories.filter(
  (directory) => !packagesThatNeedSharedSyncService.has(directory)
)
const exampleDirectories = directoriesFor(affectedWorkspaces, isExample)

const outputs = {
  package_directories: JSON.stringify(packageDirectories),
  packages_with_shared_sync_service: JSON.stringify(
    packagesWithSharedSyncService
  ),
  packages_without_shared_sync_service: JSON.stringify(
    packagesWithoutSharedSyncService
  ),
  example_directories: JSON.stringify(exampleDirectories),
  has_packages: String(packageDirectories.length > 0),
  has_shared_sync_service_packages: String(
    packagesWithSharedSyncService.length > 0
  ),
  has_non_shared_sync_service_packages: String(
    packagesWithoutSharedSyncService.length > 0
  ),
  has_examples: String(exampleDirectories.length > 0),
}

writeOutputs(outputs)

console.log(
  JSON.stringify(
    {
      baseRef,
      changedFiles,
      mode: shouldRunAll ? `all` : `affected`,
      ...outputs,
    },
    null,
    2
  )
)

function listAffectedWorkspaces(base) {
  try {
    return parsePnpmList(
      run(`pnpm`, [
        `-r`,
        `list`,
        `--depth`,
        `-1`,
        `--json`,
        `--filter`,
        `...[${base}]`,
      ])
    )
  } catch (error) {
    console.warn(
      `Falling back to all workspaces because pnpm changed-package filtering failed.`
    )
    console.warn(error.message)
    return allWorkspaces
  }
}

function listWorkspaces() {
  return parsePnpmList(run(`pnpm`, [`-r`, `list`, `--depth`, `-1`, `--json`]))
}

function parsePnpmList(output) {
  return JSON.parse(output).map((workspace) => ({
    ...workspace,
    relativePath: toPosixPath(relative(repoRoot, workspace.path)),
  }))
}

function directoriesFor(workspaces, predicate) {
  return Array.from(
    new Set(
      workspaces
        .filter(predicate)
        .map((workspace) => workspace.relativePath)
        .sort()
    )
  )
}

function isTsPackage(workspace) {
  return (
    workspace.relativePath.startsWith(`packages/`) &&
    existsSync(`${workspace.path}/tsconfig.json`)
  )
}

function isExample(workspace) {
  return (
    workspace.relativePath.startsWith(`examples/`) &&
    existsSync(`${workspace.path}/package.json`)
  )
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

function shouldRunAllWorkspaces(base, files) {
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
