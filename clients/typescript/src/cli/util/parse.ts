import fs from 'fs'
import path from 'path'
import { InvalidArgumentError } from 'commander'
import { appRoot } from './paths'

/**
 * Get the name of the current project.
 */
export function getAppName(): string | undefined {
  const packageJsonPath = path.join(appRoot, 'package.json')
  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).name
}

export function parsePort(str: string) {
  const parsed = parseInt(str)
  if (isNaN(parsed)) {
    throw new InvalidArgumentError(`Invalid port: ${str}.`)
  }
  return parsed
}

export function parseTimeout(str: string) {
  const parsed = parseInt(str)
  if (isNaN(parsed)) {
    throw new InvalidArgumentError(
      `Invalid timeout: ${str}. Must be an integer.`
    )
  }
  return parsed
}

export function extractDatabaseURL(url: string) {
  const parsed = new URL(url)
  if (!(parsed.protocol == 'postgres:' || parsed.protocol == 'postgresql:')) {
    throw new Error(`Invalid database URL: ${url}`)
  }
  return {
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    host: decodeURIComponent(parsed.hostname),
    port: parsed.port != '' ? parseInt(parsed.port) : null,
    dbName: decodeURIComponent(parsed.pathname.slice(1)),
  }
}

export function extractServiceURL(serviceUrl: string) {
  const parsed = new URL(serviceUrl)
  if (!parsed.hostname) {
    throw new Error(`Invalid service URL: ${serviceUrl}`)
  }
  return {
    host: decodeURIComponent(parsed.hostname),
    port: parsed.port ? parseInt(parsed.port) : null,
  }
}

export function parsePgProxyPort(str: string | number) {
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
