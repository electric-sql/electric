const RE = /\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g

export interface ExpandResult {
  value: string
  missing: string[]
}

function expandString(s: string, env: NodeJS.ProcessEnv): ExpandResult {
  const missing: string[] = []
  const value = s.replace(RE, (_, name: string) => {
    const v = env[name]
    if (v === undefined) {
      missing.push(name)
      return ``
    }
    return v
  })
  return { value, missing }
}

export function expandEnv(
  s: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  return expandString(s, env).value
}

expandEnv.detailed = (
  s: string,
  env: NodeJS.ProcessEnv = process.env
): ExpandResult => expandString(s, env)

expandEnv.deep = function deep<T>(
  input: T,
  env: NodeJS.ProcessEnv = process.env
): T {
  if (typeof input === `string`)
    return expandString(input, env).value as unknown as T
  if (Array.isArray(input))
    return input.map((x) => deep(x, env)) as unknown as T
  if (input && typeof input === `object`) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = deep(v, env)
    }
    return out as T
  }
  return input
}
