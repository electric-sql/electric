# Composer Input And Desktop Prompt Plan

## Status

Implemented through the core runtime, server, built-in Horton integration, and
desktop/server UI composer. Remaining work is polish-level: broader browser/a11y
coverage and future rich reference node types beyond slash commands.

## Summary

Add a standardized parsed composer-input convention to Electric Agents and update the desktop app prompt input to produce that convention.

The core runtime contract is a well-known `composer_input` inbox message type. Its payload always preserves the original source text and may include a flat, ordered list of parsed composer nodes such as slash commands, files, symbols, and branches.

The desktop app prompt should become a ProseMirror-based composer, using ProseMirror directly rather than TipTap. It should provide a small editor schema, formatting for recognized composer tokens, and slash-command autocomplete backed by the entity's discovered slash-command collection.

## Goals

- Standardize `composer_input` as a first-class inbox message type.
- Preserve raw source text alongside parsed structure.
- Support multiple structured tokens in one input, including multiple slash commands.
- Treat slash commands as one first-class composer node kind.
- Add static slash-command declarations to entity definitions.
- Materialize static and dynamic slash commands into a built-in `db.collections.slashCommands` collection.
- Expose handler-side slash-command helpers for dynamic registration.
- Put the current wake on handler context as `ctx.wake`.
- Update the desktop prompt input to use a direct ProseMirror implementation.
- Add slash-command autocomplete/popover in the desktop composer.
- Keep command execution and higher-level interpretation in handlers or helper libraries.

## Non-Goals

- Redefining `send`.
- Replacing the typed inbox message model.
- Introducing a centralized global command registry.
- Standardizing a full CLI-style argument grammar in v1.
- Fully specifying RPC request/response semantics.
- Using TipTap for the desktop composer.
- Making the ProseMirror document format part of the runtime wire contract.
- Defining nested composer parsing in v1.

## Runtime Contract

### `composer_input` Message

UIs send parsed composer input as a normal typed inbox message:

```ts
export type SendRequest = {
  from?: string
  type: string
  payload: unknown
  mode?: 'immediate' | 'queued' | 'paused' | 'steer'
  position?: string
}
```

For parsed composer submissions:

```json
{
  "type": "composer_input",
  "payload": {
    "source": "/pr-review 123 in /worktree see @Branch",
    "nodes": [
      {
        "kind": "slash_command",
        "start": 0,
        "end": 10,
        "raw": "/pr-review",
        "name": "pr-review"
      },
      {
        "kind": "text",
        "start": 10,
        "end": 18,
        "raw": " 123 in "
      },
      {
        "kind": "slash_command",
        "start": 18,
        "end": 27,
        "raw": "/worktree",
        "name": "worktree"
      },
      {
        "kind": "text",
        "start": 27,
        "end": 32,
        "raw": " see "
      },
      {
        "kind": "branch",
        "start": 32,
        "end": 39,
        "raw": "@Branch",
        "name": "Branch"
      }
    ]
  }
}
```

Suggested payload types:

```ts
export type ComposerInputPayload = {
  source: string
  nodes?: ComposerNode[]
}

export type BaseComposerNode = {
  kind: string
  start: number
  end: number
  raw: string
}

export type TextNode = BaseComposerNode & {
  kind: 'text'
}

export type SlashCommandNode = BaseComposerNode & {
  kind: 'slash_command'
  name: string
}

export type FileNode = BaseComposerNode & {
  kind: 'file'
  path: string
}

export type SymbolNode = BaseComposerNode & {
  kind: 'symbol'
  name: string
}

export type BranchNode = BaseComposerNode & {
  kind: 'branch'
  name: string
}

export type ComposerNode =
  | TextNode
  | SlashCommandNode
  | FileNode
  | SymbolNode
  | BranchNode
```

The runtime should validate structure and basic invariants, but not semantic meaning.

The wire format should tolerate unknown future node kinds for forward compatibility. Runtime validation may accept nodes with an unrecognized `kind` if they satisfy the base node invariants. Typed helper APIs should still expose a strongly discriminated union for known node kinds, with explicit fallback helpers for callers that need to inspect unknown nodes.

V1 validation should enforce:

- `source` is a string.
- `nodes`, when present, is a flat ordered array.
- `start` and `end` are JavaScript string offsets into `source`.
- `start <= end`.
- node spans do not overlap.
- `raw === source.slice(start, end)`.
- slash-command nodes have a valid command `name`.
- unknown node kinds satisfy the base node invariant and are preserved.

The runtime should not validate that a slash command exists, that a file path is accessible, or that a branch name is real. Handlers and helper libraries own those interpretations.

### Offset Semantics

`start` and `end` are JavaScript string offsets. This keeps span behavior aligned with browser and ProseMirror text handling.

Any sender that includes nodes must ensure:

```ts
node.raw === payload.source.slice(node.start, node.end)
```

## Slash Commands

### Static Declarations

Entities may declare slash commands in their definition:

```ts
export type SlashCommandDefinition = {
  name: string
  description?: string
  arguments?: Array<{
    name: string
    type: 'string' | 'number' | 'boolean'
    required?: boolean
    description?: string
  }>
}

export type EntityDefinition = {
  slashCommands?: SlashCommandDefinition[]
}
```

Slash-command names should be normalized without the leading slash. V1 should define allowed characters and case sensitivity before implementation. A conservative starting point is lowercase kebab-case names such as `quickstart`, `pr-review`, and `worktree`.

### Materialized Collection

The runtime materializes the effective slash-command list into:

```ts
db.collections.slashCommands
```

UIs use this collection for autocomplete, command pickers, help text, and argument hints.

The collection should represent the effective command list for the current entity, including both static declarations and dynamic registrations.

The effective collection is a projection, not the only source of truth. Because dynamic commands can override static commands and later disappear, the runtime must preserve enough internal state to reconstruct the effective list from layers.

Required internal model:

- static command layer seeded from `EntityDefinition.slashCommands`
- dynamic command layer keyed by command `name` and dynamic `owner`
- effective projection exposed through `db.collections.slashCommands`
- deterministic conflict resolution where dynamic commands override static commands with the same normalized name
- stable cleanup so removing a dynamic command reveals the static command with that name, if present

### Dynamic Commands

Handlers can register dynamic commands at runtime:

```ts
ctx.slashCommands.get(name)
ctx.slashCommands.register(command)
ctx.slashCommands.unregister(name)
ctx.slashCommands.list()
```

Suggested behavior:

- `register(command)` upserts by normalized `name`.
- Dynamic commands override static commands with the same name.
- Unregistering a dynamic command reveals the static declaration again, if one exists.
- The runtime needs enough provenance internally to distinguish static and dynamic layers.
- Dynamic command lifetime is source-owned and refreshable rather than permanently sticky.

Dynamic commands should carry provenance metadata that is at least available internally:

```ts
export type DynamicSlashCommandRegistration = SlashCommandDefinition & {
  owner: string
  version?: string
}
```

The initial recommendation is:

- dynamic commands are persisted as registrations with `owner` provenance
- dynamic command sources, such as skill loaders, refresh their owned registrations when they run
- if a source changes, disappears, or reports a new command set, the runtime updates the dynamic layer and recomputes the effective projection
- helpers such as `skillsLoader(ctx)` are idempotent and cheap, so they can be called at the top of every handler wake
- loaders should be able to reconcile a whole owned set, not only register/unregister one command at a time

Suggested additional helper:

```ts
ctx.slashCommands.replaceOwned(owner, commands)
```

`replaceOwned(owner, commands)` replaces all dynamic commands for that owner in one operation. This is the preferred API for sources that can report their full current command set, because it naturally removes stale commands when files, packages, feature flags, or environment capabilities change.

The runtime should watch or subscribe to command-source changes where the source supports it. For example, a skill-backed command loader should refresh registrations when skill metadata changes. If active watching is not available for a source, the source should still reconcile on each handler wake or on a periodic refresh so stale commands are eventually removed.

## Handler Context And Wake

Move the current wake onto handler context as `ctx.wake`.

The goal is a discriminated union that lets helpers reliably detect composer-input inbox wakes:

```ts
type HandlerWake = InboxWake | SpawnWake | ScheduleWake | ObservationWake

type InboxWake = {
  type: 'inbox'
  message: {
    type: string
    payload: unknown
    id?: string
    from?: string
  }
}
```

Composer-input helpers can then inspect:

```ts
if (ctx.wake.type === 'inbox' && ctx.wake.message.type === 'composer_input') {
  const payload = ctx.wake.message.payload as ComposerInputPayload
  // inspect payload.source and payload.nodes
}
```

Handler-side helper libraries should provide common operations such as:

- `getSlashCommandNodes(payload)`
- `hasSlashCommand(payload, name)`
- `firstSlashCommand(payload)`
- `textAfterNode(payload, node)`
- `nodesAfterNode(payload, node)`
- `sliceBetweenNodes(payload, startNode, endNode)`
- `knownNodes(payload)`
- `unknownNodes(payload)`

These helpers prevent every handler from reinventing fragile string slicing logic.

## Desktop ProseMirror Composer

The desktop app prompt input should be updated to a direct ProseMirror implementation.

This is an implementation detail of the desktop UI. The runtime wire format remains `ComposerInputPayload`, not the ProseMirror document.

### Requirements

- Use ProseMirror directly, not TipTap.
- Define a small composer schema.
- Support normal text editing.
- Support visual formatting for recognized composer tokens.
- Support slash-command autocomplete/popover while typing.
- Allow multiple slash commands in one input.
- Preserve a canonical source string on submit.
- Serialize the editor state to `ComposerInputPayload`.
- Keep autocomplete selection separate from execution; execution happens only on submit.

### Schema Direction

The first version should keep the schema small:

```ts
doc
block + paragraph
inline * inline
;text | hard_break | reference_atom
```

The desktop composer should support multiline input in v1. Serialization should preserve line breaks in `source`, using `\n` as the canonical line separator. ProseMirror paragraph boundaries and hard breaks both need deterministic conversion into that canonical source string.

Slash commands may be represented either as:

- plain text with decorations, which keeps typing and editing natural, or
- inline atom nodes/chips after explicit selection, which preserves metadata more strongly.

The implemented v1 uses slash-command inline atom nodes after explicit command
selection, rendered as pill-like inline blocks. This makes accepted commands
deleteable with one backspace while still preserving canonical visible source
text on submit.

Unselected or pasted slash-command text can still be serialized by deriving flat
composer nodes from the document text.

### Parser And Serializer

Build the parser/serializer before or alongside the full ProseMirror replacement. This gives the runtime and UI a shared set of real payload examples early.

The serializer should have one clear v1 policy:

- emit recognized structured nodes only
- do not emit `text` nodes by default
- preserve gaps as source text, accessible through helper functions such as `textAfterNode`

`TextNode` remains part of the type model for clients that want to send a full covering token stream, but the desktop composer should not require text-node emission in v1.

### Slash Autocomplete

The desktop composer should show a popover when the cursor is inside a slash-command token.

Trigger behavior:

- Open when the current token starts with `/`.
- Filter commands from `db.collections.slashCommands`.
- Match against command name and optionally description.
- Close on escape, blur, or when the cursor leaves the slash token.
- Support keyboard navigation.
- Insert or complete the selected command on enter/tab.
- Preserve normal text if no command is selected.
- Anchor the popover to the slash token range, not just the editor root.
- Support mouse selection without stealing focus from the editor unexpectedly.
- Use accessible listbox/menu semantics where practical.
- Keep active option state visible to screen readers where practical.
- Define behavior for IME composition so autocomplete does not corrupt partially composed text.

The popover should use the synced slash-command collection, so command updates appear without hardcoded UI configuration.

### Serialization

On submit, the composer serializes to:

```ts
type ComposerInputPayload = {
  source: string
  nodes?: ComposerNode[]
}
```

Serialization rules:

- `source` is the canonical visible text representation of the editor document.
- Nodes are emitted in source order.
- Slash-command nodes include `kind`, `start`, `end`, `raw`, and normalized `name`.
- The desktop composer emits recognized structured nodes by default, not text nodes.
- Text nodes may still be accepted from other clients that choose to send a full covering token stream.
- Rich reference atom nodes serialize to their matching node kinds.
- Every emitted node must satisfy `raw === source.slice(start, end)`.
- Multiline content serializes with `\n` line separators.

For pasted text, the composer should still recognize simple slash-command tokens where possible. It does not need to resolve rich references from pasted text in v1.

## Skill-Backed Commands

A handler-side loader can discover and register skill-backed slash commands:

```ts
export const handler = async (ctx: EntityHandlerContext) => {
  const skills = createContextSkillLoader(skillsRegistry)
  const loadedSkills = skills.load(ctx)

  // continue normal handler flow
}
```

The loader can:

- discover skill metadata
- register slash commands through `ctx.slashCommands`
- inspect `ctx.wake`
- detect relevant `composer_input` slash-command nodes
- inject skill content or context

The loader should be idempotent and cheap on repeated wakes.

The implemented runtime helper is `createContextSkillLoader`. It reconciles
user-invocable skill slash commands with `replaceOwned`, proactively loads the
matching skill when the current `composer_input` wake contains a skill slash
command, returns skill tools (`use_skill` / `remove_skill`) for model-initiated
loading, and exposes a `skills_catalog` context source that handlers can merge
into their existing `ctx.useContext` call.

## Implementation Touchpoints

Likely runtime and server files:

- `packages/agents-server/src/electric-agents-types.ts`
- `packages/agents-runtime/src/types.ts`
- `packages/agents-runtime/src/entity-schema.ts`
- `packages/agents-runtime/src/define-entity.ts`
- `packages/agents-server/src/routing/entities-router.ts`
- `packages/agents-server/src/entity-manager.ts`
- `packages/agents-runtime/src/process-wake.ts`
- `packages/agents-runtime/src/context-factory.ts`

Likely desktop and UI files:

- `packages/agents-desktop`
- `packages/agents-server-ui/src/components/MessageInput.tsx`
- `packages/agents-server-ui/src/lib/sendMessage.ts`
- a ProseMirror composer component or package shared by desktop and server UI if both need the same behavior
- slash-command picker/popover components
- composer serializer and parser helpers

Likely built-in agent files:

- `packages/agents/src/agents/horton.ts`
- skill loader and skill metadata types, if skills expose slash commands

## Suggested Milestones

### 1. Shared Types And Validation

- Add `ComposerInputPayload` and `ComposerNode` types.
- Add runtime validation for `composer_input`.
- Define offset and node invariant checks.
- Add tests for valid and invalid payloads.
- Add parser/serializer fixtures with real slash-command and multiline examples.

### 2. Static Slash Commands

- Add `EntityDefinition.slashCommands`.
- Materialize static commands into `db.collections.slashCommands`.
- Add tests for entity definition registration and UI-readable command state.

### 3. Handler Wake And Helpers

- Move or mirror wake onto `ctx.wake`.
- Tighten wake typing with at least an inbox discriminant.
- Add composer-input helper functions.
- Add tests for inbox-to-wake mapping.

### 4. Dynamic Slash Commands

- [x] Add `ctx.slashCommands` helper APIs.
- [x] Implement static/dynamic layering and override behavior.
- [x] Implement dynamic command ownership and refresh semantics.
- [x] Add `replaceOwned(owner, commands)` for whole-source reconciliation.
- [x] Watch or refresh dynamic command sources and update stale registrations.
- [x] Add tests for register, overwrite, unregister, and static reveal.

### 5. Desktop ProseMirror Composer

- [x] Replace the desktop prompt input with a direct ProseMirror editor.
- [x] Add composer schema, decorations, and submit serialization.
- [x] Add slash-command popover sourced from `db.collections.slashCommands`.
- [x] Add keyboard behavior and paste handling.
- [x] Add multiline serialization and source-span tests.
- Add basic accessibility coverage for command popover behavior.
- Add focused UI tests where practical.

### 6. Built-In Agent Integration

- [x] Update built-in handlers to accept `composer_input`.
- [x] Add skill-backed command registration if skill metadata supports it.
- [x] Add examples such as `/quickstart`, `/pr-review`, or `/worktree`.

## Follow-Up Polish

- Add browser-level coverage for command popover focus, keyboard navigation, and screen-reader semantics.
- Add richer inline reference nodes for files, symbols, and branches once the resolver UX is designed.
- Decide whether `dynamic_layers` should remain visible on `SlashCommandRow` or be hidden behind an internal metadata shape in a later cleanup.
- Extend slash-command argument metadata when the UI is ready to render structured argument hints beyond name/description.

## Decisions Before Implementation

- Dynamic slash commands are source-owned registrations with provenance. Sources refresh or replace their owned command set, and the runtime recomputes the effective collection.
- The runtime must support whole-owner reconciliation through an API such as `replaceOwned(owner, commands)`.
- The runtime should watch source changes when possible and otherwise refresh on handler wakes or periodic checks.
- The effective slash-command collection is a projection from static and dynamic layers, not the only stored command state.
- The desktop composer supports multiline input in v1 and serializes canonical source text with `\n` line separators.
- The desktop composer emits recognized structured nodes by default. It does not emit text nodes unless a later use case requires a full covering token stream.
- Unknown node kinds are wire-compatible and preserved, but typed helpers should keep known node handling strongly discriminated.
- Parser/serializer fixtures should land early, before the ProseMirror replacement is complete.

## Recommendation

Proceed with the `composer_input` convention on top of the existing typed inbox model and build the desktop prompt as the first full producer of that format.

Keep the runtime contract small and stable: raw source, flat parsed nodes, structural validation, typed wake access, and slash-command discovery. Keep ProseMirror details inside the UI layer and serialize to `ComposerInputPayload` at submit time.
