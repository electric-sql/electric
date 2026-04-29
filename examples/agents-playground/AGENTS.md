# AGENTS.md -- agents-playground

> Conventions for coding agents working in this example app.

## Structure

- `server.ts` -- entry point; creates registry, registers entities, starts HTTP server
- `entities/` -- one file per entity type, each exports a `register*` function
- `lib/electric-tools.ts` -- Electric schedule tools (cron, future-send)

## Key APIs

- `@electric-ax/agents-runtime` -- EntityRegistry, HandlerContext, createRuntimeHandler
- `@sinclair/typebox` -- tool parameter schemas (Type.Object, Type.String)

## Patterns

- Register entities via `registry.define(name, { description, state, handler })`
- Handler uses `ctx.useAgent({ systemPrompt, model, tools })` then `ctx.agent.run()`
- Spawn children with `ctx.spawn(type, id, args, { initialMessage, wake })`
- Track children in state collections with `ctx.db.actions` / `ctx.db.collections`
- Workers use the built-in `worker` entity type

## Adding entities

1. Create `entities/my-entity.ts` with `export function registerMyEntity(registry: EntityRegistry)`
2. Import and call in `server.ts`
