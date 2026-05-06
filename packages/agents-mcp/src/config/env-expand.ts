const PATTERN = /\$\{env:([A-Z_][A-Z0-9_]*)\}/g

export function expandEnv(
  input: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
): string {
  return input.replace(PATTERN, (_, name: string) => {
    const v = env[name]
    if (v === undefined) throw new Error(`Missing env var: ${name}`)
    return v
  })
}
