import fs from 'fs'
import path from 'path'
import { InvalidArgumentError } from 'commander'

export const appRoot = path.resolve() // path where the user ran `npx electric`

/**
 * Get the name of the current project.
 */
export function getAppName() {
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
}) {
  let url = 'postgresql://' + opts.user
  if (opts.password) {
    url += ':' + opts.password
  }
  url += '@' + opts.host + ':' + opts.port + '/' + opts.dbName
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
