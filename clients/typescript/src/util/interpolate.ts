/**
 * Replace all `?` parameter placeholders in SQL with provided args.
 */
export function interpolateSqlArgs({
  sql,
  args,
}: {
  sql: string
  args?: string[]
}): string {
  if (args === undefined) return sql

  let matchPos = 0
  const argsLength = args.length
  /* We're looking for any `?` in the provided sql statement that aren't preceded by a word character
     This is how `builder.ts#makeFilter` builds SQL statements, but we need to interpolate them before
     sending to the server. SQL here shouldn't contain any user strings, only placeholders, so it's safe.
      
     This could be achieved with a negative lookbehind, i.e. /(?<!\w)\?/g, but it has limited support
     across browsers so an alternative, less elegant approach is used where we include preceding
     characters in the match.
     See https://caniuse.com/js-regexp-lookbehind
  */
  return sql.replaceAll(/(?:^|[^\w])\?/g, (match) => {
    const toReplace = matchPos < argsLength ? args[matchPos++] : '?'

    // include preceding character if matched
    return match.length > 1 ? match[0] + toReplace : toReplace
  })
}
