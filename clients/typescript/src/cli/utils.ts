import fs from 'fs'
import path from 'path'
import url from 'url'
import { InvalidArgumentError } from 'commander'

export const appRoot = path.resolve() // path where the user ran `npx electric`

/**
 * Get the name of the current project.
 */
export function getAppName(): string | undefined {
  const packageJsonPath = path.join(appRoot, 'package.json')
  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).name
}

/**
 * Tagged template literal dedent function that also unwraps lines.
 * Double newlines become a single newline.
 */
export function dedent(
  strings: TemplateStringsArray,
  ...values: unknown[]
): string {
  let str = strings[0]
  for (let i = 0; i < values.length; i++) {
    str += String(values[i]) + strings[i + 1]
  }

  const lines = str.split('\n')

  const minIndent = lines
    .filter((line) => line.trim())
    .reduce((minIndent, line) => {
      const indent = line.match(/^\s*/)![0].length
      return indent < minIndent ? indent : minIndent
    }, Infinity)

  if (lines[0] === '') {
    // if first line is empty, remove it
    lines.shift()
  }
  if (lines[lines.length - 1] === '') {
    // if last line is empty, remove it
    lines.pop()
  }

  return lines
    .map((line) => {
      line = line.slice(minIndent)
      if (/^\s/.test(line)) {
        // if line starts with whitespace, prefix it with a newline
        // to preserve the indentation
        return '\n' + line
      } else if (line === '') {
        // if line is empty, we want a newline here
        return '\n'
      } else {
        return line.trim() + ' '
      }
    })
    .join('')
    .trim()
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

export function buildDatabaseURL(opts: {
  user: string
  password: string
  host: string
  port: number
  dbName: string
  ssl?: boolean
}) {
  let url = 'postgresql://' + opts.user
  if (opts.password) {
    url += ':' + opts.password
  }
  url += '@' + opts.host + ':' + opts.port + '/' + opts.dbName

  if (opts.ssl === false) {
    url += '?sslmode=disable'
  }
  return url
}

export function extractDatabaseURL(url: string) {
  const match = url.match(
    /^postgres(ql)?:\/\/([^:]+)(?::([^@]+))?@([^:]+):(\d+)\/(.+)$/
  )
  if (!match) {
    throw new Error(`Invalid database URL: ${url}`)
  }
  return {
    user: match[2],
    password: match[3] ?? '',
    host: match[4],
    port: parseInt(match[5]),
    dbName: match[6],
  }
}

export function extractServiceURL(serviceUrl: string) {
  const parsed = url.parse(serviceUrl)
  if (!parsed.hostname) {
    throw new Error(`Invalid service URL: ${serviceUrl}`)
  }
  return {
    host: parsed.hostname,
    port: parsed.port ? parseInt(parsed.port) : undefined,
  }
}

export function parsePgProxyPort(str: string) {
  if (str.includes(':')) {
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
