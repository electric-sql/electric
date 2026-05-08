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
      // Producers (e.g. agents-runtime.registerTypes) POST entity
      // types one at a time and parallelise up to N at a time, each
      // carrying a single-element `types` array. Last-write-wins on
      // the entry would drop every type but the most recently
      // registered one — and the "winner" is whichever POST happened
      // to land last. Merge types instead, deduping while preserving
      // first-seen order, and keep the latest `publicUrl` so a
      // restarted runtime on a new port still updates correctly.
      const existing = map.get(r.name)
      if (!existing) {
        map.set(r.name, { ...r, types: [...r.types] })
        return
      }
      const seen = new Set(existing.types)
      const mergedTypes = [...existing.types]
      for (const t of r.types) {
        if (!seen.has(t)) {
          seen.add(t)
          mergedTypes.push(t)
        }
      }
      map.set(r.name, {
        name: r.name,
        publicUrl: r.publicUrl ?? existing.publicUrl,
        types: mergedTypes,
      })
    },
    list() {
      return [...map.values()].filter((r) => !!r.publicUrl) as Array<
        Required<RuntimeRegistration>
      >
    },
  }
}
