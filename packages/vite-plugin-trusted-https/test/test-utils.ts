import { execSync } from "child_process"

export const ENABLE_INTEGRATION_TESTS =
  process.env.VITEST_INTEGRATION === `true`
export const ENABLE_FULL_INTEGRATION_TESTS =
  process.env.VITEST_FULL_INTEGRATION === `true`

export function hasCommand(command: string): boolean {
  try {
    execSync(`which ${command}`, { stdio: `ignore`, timeout: 5000 })
    return true
  } catch {
    try {
      // Windows alternative
      execSync(`where ${command}`, { stdio: `ignore`, timeout: 5000 })
      return true
    } catch {
      return false
    }
  }
}

export function canTestTrustInstaller(): boolean {
  if (!ENABLE_FULL_INTEGRATION_TESTS) return false

  switch (process.platform) {
    case `darwin`:
      return hasCommand(`security`)
    case `linux`:
      return hasCommand(`update-ca-certificates`)
    case `win32`:
      return hasCommand(`certutil`)
    default:
      return false
  }
}

export function skipIfNotPlatform(platform: NodeJS.Platform) {
  return process.platform !== platform
}

export function skipIfNoIntegration() {
  return !ENABLE_INTEGRATION_TESTS
}

export function skipIfCannotTestTrust() {
  return !canTestTrustInstaller()
}

export function createTempCertDir(): string {
  const tempDir = `test-certs-${Date.now()}-${Math.random().toString(36).substring(7)}`
  return tempDir
}
