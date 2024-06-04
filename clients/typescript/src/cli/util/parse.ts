import fs from 'fs'
import { InvalidArgumentError } from 'commander'
import { appPackageJsonPath } from './paths'

/**
 * Get the name of the current project.
 */
export function getAppName(): string | undefined {
  return JSON.parse(fs.readFileSync(appPackageJsonPath, 'utf8')).name
}

export function parsePort(str: string): number {
  const parsed = parseInt(str)
  if (isNaN(parsed)) {
    throw new InvalidArgumentError(`Invalid port: ${str}.`)
  }
  return parsed
}

export function parseTimeout(str: string): number {
  const parsed = parseInt(str)
  if (isNaN(parsed)) {
    throw new InvalidArgumentError(
      `Invalid timeout: ${str}. Must be an integer.`
    )
  }
  return parsed
}

export function extractDatabaseURL(url: string): {
  user: string
  password: string
  host: string
  port: number | null
  dbName: string
} {
  const parsed = new URL(url)
  if (!(parsed.protocol == 'postgres:' || parsed.protocol == 'postgresql:')) {
    throw new Error(`Invalid database URL scheme: ${url}`)
  }

  const user = decodeURIComponent(parsed.username)
  if (!user) {
    throw new Error(`Invalid or missing username: ${url}`)
  }

  return {
    user: user,
    password: decodeURIComponent(parsed.password),
    host: decodeURIComponent(parsed.hostname),
    port: parsed.port ? parseInt(parsed.port) : null,
    dbName: decodeURIComponent(parsed.pathname.slice(1)) || user,
  }
}

export function extractServiceURL(serviceUrl: string): {
  host: string
  port: number | null
} {
  const parsed = new URL(serviceUrl)
  if (!parsed.hostname) {
    throw new Error(`Invalid service URL: ${serviceUrl}`)
  }
  return {
    host: decodeURIComponent(parsed.hostname),
    port: parsed.port ? parseInt(parsed.port) : null,
  }
}

export function parsePgProxyPort(str: string | number): {
  http: boolean
  port: number
} {
  if (typeof str === 'number') {
    return { http: false, port: str }
  } else if (str.includes(':')) {
    const [prefix, port] = str.split(':')
    return {
      http: prefix.toLocaleLowerCase() === 'http',
      port: parsePort(port),
    }
  } else if (str.toLocaleLowerCase() === 'http') {
    return { http: true, port: 65432 }
  } else {
    return { http: false, port: parsePort(str) }
  }
}
