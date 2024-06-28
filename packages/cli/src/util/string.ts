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
      const indent = line.match(/^\s*/)?.[0].length ?? 0
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

/**
 * Builds the Postgres database URL for the given parameters.
 */
export function buildDatabaseURL(opts: {
  user: string
  password: string
  host: string
  port: number
  dbName: string
  ssl?: boolean
}): string {
  const base = new URL(`postgresql://${opts.host}`)
  base.username = opts.user
  base.password = opts.password
  base.port = opts.port.toString()
  base.pathname = opts.dbName
  if (opts.ssl !== undefined) {
    base.searchParams.set('sslmode', opts.ssl ? 'require' : 'disable')
  }

  return base.toString()
}
