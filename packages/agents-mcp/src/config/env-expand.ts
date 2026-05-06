const VALID_PATTERN = /\$\{env:([A-Z_][A-Z0-9_]*)\}/g
const SENTINEL_PATTERN = /\$\{env:[^}]*\}/g

export function expandEnv(
  input: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
): string {
  for (const match of input.matchAll(SENTINEL_PATTERN)) {
    const inner = match[0].slice(6, -1)
    if (!/^[A-Z_][A-Z0-9_]*$/.test(inner)) {
      throw new Error(
        `Invalid env var placeholder: ${match[0]} (names must match [A-Z_][A-Z0-9_]*)`
      )
    }
  }
  return input.replace(VALID_PATTERN, (_, name: string) => {
    const v = env[name]
    if (v === undefined) throw new Error(`Missing env var: ${name}`)
    return v
  })
}
