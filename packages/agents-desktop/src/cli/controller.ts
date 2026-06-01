import { spawn } from 'node:child_process'
import { access, chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { constants as fsConstants } from 'node:fs'
import { ELECTRIC_CLI_ENTRY_PATH } from '../shared/paths'
import type { ElectricCliStatus } from '../shared/types'

const COMMAND = `electric`
const SHIM_VERSION = 1
const MANAGED_MARKER = `electric-agents-cli-shim-version: ${SHIM_VERSION}`
const VERSION_TIMEOUT_MS = 5_000

export type CliController = ReturnType<typeof createCliController>

export function createCliController() {
  const getStatus = async (): Promise<ElectricCliStatus> => {
    const bundledVersion = await readBundledCliVersion()
    const installDir = defaultInstallDir()
    const installDirOnPath = pathIncludes(installDir)
    const managedPath = managedShimPath(installDir)
    const matches = await findCommandsOnPath(COMMAND)
    const managedShim = await readManagedShim(managedPath)
    const firstPath = matches[0] ?? null

    if (!firstPath && !managedShim.exists) {
      return status(bundledVersion, {
        kind: `not-installed`,
        path: null,
        version: null,
        managedPath: null,
        installDir,
        installDirOnPath,
        error: null,
      })
    }

    if (managedShim.exists && !managedShim.managed) {
      return status(bundledVersion, {
        kind: firstPath === managedPath ? `manual` : `shadowed`,
        path: firstPath,
        version: firstPath ? await readCliVersion(firstPath) : null,
        managedPath: null,
        installDir,
        installDirOnPath,
        error: `A file already exists at the managed install path but was not created by Electric Agents Desktop.`,
      })
    }

    if (managedShim.exists && firstPath !== managedPath) {
      return status(bundledVersion, {
        kind: `shadowed`,
        path: firstPath,
        version: firstPath ? await readCliVersion(firstPath) : null,
        managedPath,
        installDir,
        installDirOnPath,
        error: firstPath
          ? `A different electric command appears earlier on PATH.`
          : `The managed CLI install directory is not on PATH.`,
      })
    }

    if (managedShim.exists) {
      const versionResult = await readCliVersionResult(managedPath)
      return status(bundledVersion, {
        kind: versionResult.error ? `broken` : `managed`,
        path: managedPath,
        version: versionResult.version,
        managedPath,
        installDir,
        installDirOnPath,
        error: versionResult.error,
      })
    }

    return status(bundledVersion, {
      kind: `manual`,
      path: firstPath,
      version: firstPath ? await readCliVersion(firstPath) : null,
      managedPath: null,
      installDir,
      installDirOnPath,
      error: null,
    })
  }

  const install = async (): Promise<ElectricCliStatus> => {
    const installDir = defaultInstallDir()
    const target = managedShimPath(installDir)
    const existing = await readManagedShim(target)
    if (existing.exists && !existing.managed) {
      throw new Error(
        `Cannot install Electric CLI because ${target} already exists and is not managed by Electric Agents Desktop.`
      )
    }
    await assertCliEntryExists()
    await mkdir(installDir, { recursive: true })
    await writeFile(target, shimContents(), `utf8`)
    if (process.platform !== `win32`) {
      await chmod(target, 0o755)
    }
    return getStatus()
  }

  const uninstall = async (): Promise<ElectricCliStatus> => {
    const target = managedShimPath(defaultInstallDir())
    const existing = await readManagedShim(target)
    if (existing.exists && !existing.managed) {
      throw new Error(
        `Refusing to remove ${target} because it is not managed by Electric Agents Desktop.`
      )
    }
    if (existing.exists) await rm(target, { force: true })
    return getStatus()
  }

  return { getStatus, install, uninstall }
}

function status(
  bundledVersion: string,
  input: Omit<ElectricCliStatus, `command` | `bundledVersion`>
) {
  return {
    command: COMMAND,
    bundledVersion,
    ...input,
  } satisfies ElectricCliStatus
}

function defaultInstallDir(): string {
  if (process.platform === `win32`) {
    return path.join(os.homedir(), `AppData`, `Local`, `Electric`, `bin`)
  }
  return path.join(os.homedir(), `.local`, `bin`)
}

function shimName(): string {
  return process.platform === `win32` ? `${COMMAND}.cmd` : COMMAND
}

function managedShimPath(installDir: string): string {
  return path.join(installDir, shimName())
}

function normalizePath(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === `win32` ? resolved.toLowerCase() : resolved
}

function pathIncludes(dir: string): boolean {
  const normalizedDir = normalizePath(dir)
  return pathEntries().some((entry) => normalizePath(entry) === normalizedDir)
}

function pathEntries(): string[] {
  return (process.env.PATH ?? ``).split(path.delimiter).filter(Boolean)
}

async function findCommandsOnPath(command: string): Promise<string[]> {
  const names =
    process.platform === `win32`
      ? [`${command}.cmd`, `${command}.exe`, command]
      : [command]
  const found: string[] = []
  const seen = new Set<string>()
  for (const dir of pathEntries()) {
    for (const name of names) {
      const candidate = path.join(dir, name)
      const normalized = normalizePath(candidate)
      if (seen.has(normalized)) continue
      if (await isExecutable(candidate)) {
        seen.add(normalized)
        found.push(candidate)
      }
    }
  }
  return found
}

async function isExecutable(candidate: string): Promise<boolean> {
  try {
    await access(
      candidate,
      process.platform === `win32`
        ? fsConstants.F_OK
        : fsConstants.F_OK | fsConstants.X_OK
    )
    return true
  } catch {
    return false
  }
}

async function readManagedShim(
  candidate: string
): Promise<{ exists: boolean; managed: boolean }> {
  try {
    const contents = await readFile(candidate, `utf8`)
    return { exists: true, managed: contents.includes(MANAGED_MARKER) }
  } catch {
    return { exists: false, managed: false }
  }
}

async function assertCliEntryExists(): Promise<void> {
  try {
    await access(ELECTRIC_CLI_ENTRY_PATH, fsConstants.F_OK)
  } catch {
    throw new Error(
      `Bundled Electric CLI was not found at ${ELECTRIC_CLI_ENTRY_PATH}. Run the desktop build first.`
    )
  }
}

function shimContents(): string {
  return process.platform === `win32`
    ? windowsShimContents()
    : posixShimContents()
}

function posixShimContents(): string {
  return [
    `#!/bin/sh`,
    `# Managed by Electric Agents Desktop`,
    `# ${MANAGED_MARKER}`,
    `export ELECTRON_RUN_AS_NODE=1`,
    `exec ${shQuote(process.execPath)} ${shQuote(ELECTRIC_CLI_ENTRY_PATH)} "$@"`,
    ``,
  ].join(`\n`)
}

function windowsShimContents(): string {
  return [
    `@echo off`,
    `REM Managed by Electric Agents Desktop`,
    `REM ${MANAGED_MARKER}`,
    `set ELECTRON_RUN_AS_NODE=1`,
    `"${process.execPath}" "${ELECTRIC_CLI_ENTRY_PATH}" %*`,
    ``,
  ].join(`\r\n`)
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function readCliVersion(file: string): Promise<string | null> {
  return (await readCliVersionResult(file)).version
}

async function readBundledCliVersion(): Promise<string> {
  const result = await execFileWithTimeout(
    process.execPath,
    [ELECTRIC_CLI_ENTRY_PATH, `--version`],
    VERSION_TIMEOUT_MS,
    { ...process.env, ELECTRON_RUN_AS_NODE: `1` }
  )
  if (result.error) return `unknown`
  return result.stdout.trim().split(/\s+/)[0] || `unknown`
}

async function readCliVersionResult(
  file: string
): Promise<{ version: string | null; error: string | null }> {
  const result = await execFileWithTimeout(
    file,
    [`--version`],
    VERSION_TIMEOUT_MS
  )
  if (result.error) {
    return { version: null, error: result.error.message }
  }
  const version = result.stdout.trim().split(/\s+/)[0] ?? null
  return { version: version || null, error: null }
}

function execFileWithTimeout(
  file: string,
  args: string[],
  timeoutMs: number,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ stdout: string; error: Error | null }> {
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      env,
      stdio: [`ignore`, `pipe`, `pipe`],
    })
    let stdout = ``
    let stderr = ``
    const timeout = setTimeout(() => {
      child.kill()
      resolve({
        stdout,
        error: new Error(`Timed out while checking Electric CLI version.`),
      })
    }, timeoutMs)
    child.stdout?.setEncoding(`utf8`)
    child.stderr?.setEncoding(`utf8`)
    child.stdout?.on(`data`, (chunk: string) => {
      stdout += chunk
    })
    child.stderr?.on(`data`, (chunk: string) => {
      stderr += chunk
    })
    child.on(`error`, (error) => {
      clearTimeout(timeout)
      resolve({ stdout, error })
    })
    child.on(`close`, (code) => {
      clearTimeout(timeout)
      if (code === 0) {
        resolve({ stdout, error: null })
        return
      }
      resolve({
        stdout,
        error: new Error(
          stderr.trim() || `Electric CLI exited with code ${code}.`
        ),
      })
    })
  })
}
