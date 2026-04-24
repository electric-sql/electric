export function expandEnvVars(
  template: string,
  env: Record<string, string | undefined>
): string {
  return template.replace(
    /\$\{([^}:]+?)(?::-(.*?))?\}/g,
    (_match, name: string, defaultValue?: string) => {
      const value = env[name]
      if (value !== undefined) return value
      if (defaultValue !== undefined) return defaultValue
      throw new Error(
        `Environment variable \${${name}} is required but not set`
      )
    }
  )
}

export function expandConfigValues<T>(
  obj: T,
  env: Record<string, string | undefined>
): T {
  if (typeof obj === `string`) {
    return expandEnvVars(obj, env) as T
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => expandConfigValues(item, env)) as T
  }
  if (obj !== null && typeof obj === `object`) {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandConfigValues(value, env)
    }
    return result as T
  }
  return obj
}
