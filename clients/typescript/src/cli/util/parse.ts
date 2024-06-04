import fs from 'fs'
import { InvalidArgumentError } from 'commander'
import { appPackageJsonPath } from './paths'

/**
 * Get the name of the current project.
 */
export function getAppName(): string | undefined {
  return JSON.parse(fs.readFileSync(appPackageJsonPath, 'utf8')).name
}

/**
 * Parse an integer from a string and throw the given error
 * if parsing fails
 */
function parseIntOrFail(str: string, error: string) {
  const parsed = parseInt(str)
  if (isNaN(parsed)) {
    throw new InvalidArgumentError(error)
  }
  return parsed
}

export function parsePort(str: string): number {
  return parseIntOrFail(
    str,
    `Invalid port: ${str}. Must be integer between 1 and 65535.`
  )
}

export function parseTimeout(str: string): number {
  return parseIntOrFail(str, `Invalid timeout: ${str}. Must be an integer.`)
}

export function extractDatabaseURL(url: string): {
  user: string
  password: string
  host: string
  port: number | null
  dbName: string
} {
  const parsed = new URL(url)
  if (!(parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:')) {
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
