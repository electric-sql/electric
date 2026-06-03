declare module '@electric-ax/agents-runtime' {
  export type EntityDefinition = {
    description?: string
    creationSchema?: unknown
    handler: (ctx: any, wake: any) => void | Promise<void>
  }

  export type EntityRegistry = {
    define(name: string, definition: EntityDefinition): void
  }
}
