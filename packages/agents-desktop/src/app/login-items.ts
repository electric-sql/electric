import { app } from 'electron'
import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BACKGROUND_LAUNCH_ARG } from '../shared/constants'
import type { LaunchAtLoginStatus } from '../shared/types'

const LAUNCH_AGENT_LABEL = `com.electric-sql.agents.launch-at-login`

function isMac(): boolean {
  return process.platform === `darwin`
}

function isWindows(): boolean {
  return process.platform === `win32`
}

function hasBackgroundLaunchArg(argv: ReadonlyArray<string>): boolean {
  return argv.includes(BACKGROUND_LAUNCH_ARG)
}

export function isBackgroundLaunch(argv = process.argv): boolean {
  return hasBackgroundLaunchArg(argv)
}

export function shouldOpenWindowForSecondInstance(
  argv: ReadonlyArray<string>
): boolean {
  return !hasBackgroundLaunchArg(argv)
}

function launchAgentsDir(): string {
  return path.join(app.getPath(`home`), `Library`, `LaunchAgents`)
}

function launchAgentPath(): string {
  return path.join(launchAgentsDir(), `${LAUNCH_AGENT_LABEL}.plist`)
}

function xmlEscape(value: string): string {
  return value
    .replaceAll(`&`, `&amp;`)
    .replaceAll(`<`, `&lt;`)
    .replaceAll(`>`, `&gt;`)
    .replaceAll(`"`, `&quot;`)
    .replaceAll(`'`, `&apos;`)
}

function appLaunchArguments(): Array<string> {
  return app.isPackaged
    ? [process.execPath, BACKGROUND_LAUNCH_ARG]
    : [process.execPath, app.getAppPath(), BACKGROUND_LAUNCH_ARG]
}

function launchAgentPlist(): string {
  const args = appLaunchArguments()
    .map((arg) => `    <string>${xmlEscape(arg)}</string>`)
    .join(`\n`)

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
`
}

async function launchAgentExists(): Promise<boolean> {
  try {
    await access(launchAgentPath())
    return true
  } catch {
    return false
  }
}

async function setMacLaunchAtLogin(enabled: boolean): Promise<void> {
  if (enabled) {
    await mkdir(launchAgentsDir(), { recursive: true })
    await writeFile(launchAgentPath(), launchAgentPlist(), `utf8`)
    return
  }

  await rm(launchAgentPath(), { force: true })
}

function setNativeLaunchAtLogin(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    args: [BACKGROUND_LAUNCH_ARG],
  })
}

export async function setLaunchAtLogin(
  enabled: boolean
): Promise<LaunchAtLoginStatus> {
  if (isMac()) {
    await setMacLaunchAtLogin(enabled)
    return getLaunchAtLoginStatus()
  }

  if (isWindows()) {
    setNativeLaunchAtLogin(enabled)
    return getLaunchAtLoginStatus()
  }

  return getLaunchAtLoginStatus()
}

export async function getLaunchAtLoginStatus(): Promise<LaunchAtLoginStatus> {
  if (isMac()) {
    return {
      supported: true,
      enabled: await launchAgentExists(),
      reason: null,
    }
  }

  if (isWindows()) {
    const settings = app.getLoginItemSettings({
      args: [BACKGROUND_LAUNCH_ARG],
    })
    return {
      supported: true,
      enabled: settings.openAtLogin,
      reason: null,
    }
  }

  return {
    supported: false,
    enabled: false,
    reason: `Launch at login is not supported on this platform yet.`,
  }
}
