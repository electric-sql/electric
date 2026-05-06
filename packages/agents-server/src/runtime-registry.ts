export interface RuntimeRegistration {
  name: string
  publicUrl?: string
  types: string[]
}

export interface RuntimeRegistry {
  register(r: RuntimeRegistration): void
  list(): Array<Required<RuntimeRegistration>>
}

export function createRuntimeRegistry(): RuntimeRegistry {
  const map = new Map<string, RuntimeRegistration>()
  return {
    register(r) {
      if (!r.publicUrl) {
        console.warn(
          `[agents-server] runtime "${r.name}" registered without publicUrl; omitted from /api/runtimes`
        )
      }
      map.set(r.name, r)
    },
    list() {
      return [...map.values()].filter((r) => !!r.publicUrl) as Array<
        Required<RuntimeRegistration>
      >
    },
  }
}
