export const COMPOSER_INPUT_MESSAGE_TYPE = `composer_input`

export type ComposerNodeKind =
  | `text`
  | `slash_command`
  | `file`
  | `symbol`
  | `branch`

export interface BaseComposerNode {
  kind: string
  start: number
  end: number
  raw: string
}

export interface TextComposerNode extends BaseComposerNode {
  kind: `text`
}

export interface SlashCommandComposerNode extends BaseComposerNode {
  kind: `slash_command`
  name: string
}

export interface FileComposerNode extends BaseComposerNode {
  kind: `file`
  path: string
}

export interface SymbolComposerNode extends BaseComposerNode {
  kind: `symbol`
  name: string
}

export interface BranchComposerNode extends BaseComposerNode {
  kind: `branch`
  name: string
}

export type KnownComposerNode =
  | TextComposerNode
  | SlashCommandComposerNode
  | FileComposerNode
  | SymbolComposerNode
  | BranchComposerNode

export type ComposerNode = KnownComposerNode

export interface WireComposerInputPayload {
  source: string
  nodes?: Array<BaseComposerNode>
}

export interface ComposerInputPayload {
  source: string
  nodes?: Array<KnownComposerNode>
}

export type SlashCommandArgumentType = `string` | `number` | `boolean`

export interface SlashCommandArgumentDefinition {
  name: string
  type: SlashCommandArgumentType
  required?: boolean
  description?: string
}

export interface SlashCommandDefinition {
  name: string
  description?: string
  arguments?: Array<SlashCommandArgumentDefinition>
}

export interface DynamicSlashCommandRegistration
  extends SlashCommandDefinition {
  owner?: string
  version?: string
}

export interface SlashCommandRow extends SlashCommandDefinition {
  key?: string
  source: `static` | `dynamic`
  owner?: string
  version?: string
  updated_at: string
  /**
   * Internal layer state used by ctx.slashCommands to reconstruct the
   * effective command after dynamic owners unregister. Consumers should read
   * the top-level row fields as the effective command.
   */
  dynamic_layers?: Array<
    DynamicSlashCommandRegistration & { updated_at: string }
  >
}

export interface SlashCommandHelpers {
  get: (name: string) => SlashCommandRow | undefined
  list: () => Array<SlashCommandRow>
  register: (command: DynamicSlashCommandRegistration) => void
  unregister: (name: string, opts?: { owner?: string }) => void
  replaceOwned: (
    owner: string,
    commands: Array<Omit<DynamicSlashCommandRegistration, `owner`>>
  ) => void
}

export type ComposerInputValidationIssue = {
  path: string
  message: string
}

export type ComposerInputValidationError = {
  message: string
  details: Array<ComposerInputValidationIssue>
}

const SLASH_COMMAND_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const SLASH_COMMAND_ARGUMENT_NAME_PATTERN = /^[a-z][a-zA-Z0-9_]*$/

export function validateComposerInputPayload(
  payload: unknown
): ComposerInputValidationError | null {
  const details: Array<ComposerInputValidationIssue> = []

  if (!isRecord(payload)) {
    return {
      message: `Validation failed`,
      details: [{ path: `/`, message: `must be an object` }],
    }
  }

  if (typeof payload.source !== `string`) {
    details.push({ path: `/source`, message: `must be a string` })
  }

  if (`nodes` in payload && payload.nodes !== undefined) {
    if (!Array.isArray(payload.nodes)) {
      details.push({ path: `/nodes`, message: `must be an array` })
    } else if (typeof payload.source === `string`) {
      validateComposerNodes(payload.source, payload.nodes, details)
    }
  }

  if (details.length > 0) {
    return { message: `Validation failed`, details }
  }

  return null
}

export function validateSlashCommandDefinitions(
  commands: unknown
): ComposerInputValidationError | null {
  if (commands === undefined) {
    return null
  }

  if (!Array.isArray(commands)) {
    return {
      message: `Validation failed`,
      details: [{ path: `/slash_commands`, message: `must be an array` }],
    }
  }

  const details: Array<ComposerInputValidationIssue> = []
  const names = new Set<string>()

  commands.forEach((command, index) => {
    const path = `/slash_commands/${index}`
    if (!isRecord(command)) {
      details.push({ path, message: `must be an object` })
      return
    }

    if (
      typeof command.name !== `string` ||
      !SLASH_COMMAND_NAME_PATTERN.test(command.name)
    ) {
      details.push({
        path: `${path}/name`,
        message: `must be a lowercase kebab-case command name`,
      })
    } else if (names.has(command.name)) {
      details.push({
        path: `${path}/name`,
        message: `must be unique`,
      })
    } else {
      names.add(command.name)
    }

    if (
      `description` in command &&
      command.description !== undefined &&
      typeof command.description !== `string`
    ) {
      details.push({ path: `${path}/description`, message: `must be a string` })
    }

    validateSlashCommandArguments(
      command.arguments,
      `${path}/arguments`,
      details
    )
  })

  if (details.length > 0) {
    return { message: `Validation failed`, details }
  }

  return null
}

export function isKnownComposerNode(
  node: BaseComposerNode
): node is KnownComposerNode {
  switch (node.kind) {
    case `text`:
      return true
    case `slash_command`:
      return hasStringField(node, `name`)
    case `file`:
      return hasStringField(node, `path`)
    case `symbol`:
    case `branch`:
      return hasStringField(node, `name`)
    default:
      return false
  }
}

export function getSlashCommandNodes(
  payload: WireComposerInputPayload
): Array<SlashCommandComposerNode> {
  return (payload.nodes ?? []).filter(
    (node): node is SlashCommandComposerNode =>
      node.kind === `slash_command` && hasStringField(node, `name`)
  )
}

export function hasSlashCommand(
  payload: WireComposerInputPayload,
  name: string
): boolean {
  return getSlashCommandNodes(payload).some((node) => node.name === name)
}

export function firstSlashCommand(
  payload: WireComposerInputPayload
): SlashCommandComposerNode | undefined {
  return getSlashCommandNodes(payload)[0]
}

export function textAfterNode(
  payload: Pick<WireComposerInputPayload, `source`>,
  node: BaseComposerNode
): string {
  return payload.source.slice(node.end)
}

export function knownNodes(
  payload: WireComposerInputPayload
): Array<KnownComposerNode> {
  return (payload.nodes ?? []).filter(isKnownComposerNode)
}

export function unknownNodes(
  payload: WireComposerInputPayload
): Array<BaseComposerNode> {
  return (payload.nodes ?? []).filter((node) => !isKnownComposerNode(node))
}

function validateComposerNodes(
  source: string,
  nodes: Array<unknown>,
  details: Array<ComposerInputValidationIssue>
): void {
  let previousEnd = 0

  nodes.forEach((node, index) => {
    const path = `/nodes/${index}`
    if (!isRecord(node)) {
      details.push({ path, message: `must be an object` })
      return
    }

    validateBaseNode(source, node, path, previousEnd, details)

    const start = node.start
    const end = node.end
    if (
      typeof start === `number` &&
      typeof end === `number` &&
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      start >= previousEnd &&
      start <= end
    ) {
      previousEnd = end
    }

    validateKnownNodeFields(node, path, details)
  })
}

function validateBaseNode(
  source: string,
  node: Record<string, unknown>,
  path: string,
  previousEnd: number,
  details: Array<ComposerInputValidationIssue>
): void {
  if (typeof node.kind !== `string` || node.kind.length === 0) {
    details.push({
      path: `${path}/kind`,
      message: `must be a non-empty string`,
    })
  }

  if (!Number.isInteger(node.start)) {
    details.push({ path: `${path}/start`, message: `must be an integer` })
  }

  if (!Number.isInteger(node.end)) {
    details.push({ path: `${path}/end`, message: `must be an integer` })
  }

  if (typeof node.raw !== `string`) {
    details.push({ path: `${path}/raw`, message: `must be a string` })
  }

  if (!Number.isInteger(node.start) || !Number.isInteger(node.end)) {
    return
  }

  const start = node.start as number
  const end = node.end as number

  if (start < 0) {
    details.push({ path: `${path}/start`, message: `must be >= 0` })
  }

  if (end < start) {
    details.push({ path: `${path}/end`, message: `must be >= start` })
  }

  if (end > source.length) {
    details.push({ path: `${path}/end`, message: `must be within source` })
  }

  if (start < previousEnd) {
    details.push({
      path: `${path}/start`,
      message: `must not overlap the previous node`,
    })
  }

  if (typeof node.raw === `string` && source.slice(start, end) !== node.raw) {
    details.push({
      path: `${path}/raw`,
      message: `must equal source.slice(start, end)`,
    })
  }
}

function validateKnownNodeFields(
  node: Record<string, unknown>,
  path: string,
  details: Array<ComposerInputValidationIssue>
): void {
  switch (node.kind) {
    case `text`:
      return
    case `slash_command`:
      if (
        typeof node.name !== `string` ||
        !SLASH_COMMAND_NAME_PATTERN.test(node.name)
      ) {
        details.push({
          path: `${path}/name`,
          message: `must be a lowercase kebab-case command name`,
        })
      }
      return
    case `file`:
      if (typeof node.path !== `string` || node.path.length === 0) {
        details.push({ path: `${path}/path`, message: `must be a string` })
      }
      return
    case `symbol`:
    case `branch`:
      if (typeof node.name !== `string` || node.name.length === 0) {
        details.push({
          path: `${path}/name`,
          message: `must be a non-empty string`,
        })
      }
      return
  }
}

function validateSlashCommandArguments(
  args: unknown,
  path: string,
  details: Array<ComposerInputValidationIssue>
): void {
  if (args === undefined) {
    return
  }

  if (!Array.isArray(args)) {
    details.push({ path, message: `must be an array` })
    return
  }

  const names = new Set<string>()
  args.forEach((arg, index) => {
    const argPath = `${path}/${index}`
    if (!isRecord(arg)) {
      details.push({ path: argPath, message: `must be an object` })
      return
    }

    if (
      typeof arg.name !== `string` ||
      !SLASH_COMMAND_ARGUMENT_NAME_PATTERN.test(arg.name)
    ) {
      details.push({
        path: `${argPath}/name`,
        message: `must be a valid argument name`,
      })
    } else if (names.has(arg.name)) {
      details.push({ path: `${argPath}/name`, message: `must be unique` })
    } else {
      names.add(arg.name)
    }

    if (
      arg.type !== `string` &&
      arg.type !== `number` &&
      arg.type !== `boolean`
    ) {
      details.push({
        path: `${argPath}/type`,
        message: `must be string, number, or boolean`,
      })
    }

    if (
      `required` in arg &&
      arg.required !== undefined &&
      typeof arg.required !== `boolean`
    ) {
      details.push({
        path: `${argPath}/required`,
        message: `must be a boolean`,
      })
    }

    if (
      `description` in arg &&
      arg.description !== undefined &&
      typeof arg.description !== `string`
    ) {
      details.push({
        path: `${argPath}/description`,
        message: `must be a string`,
      })
    }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === `object` && !Array.isArray(value)
}

function hasStringField(
  value: BaseComposerNode,
  field: string
): value is BaseComposerNode & Record<string, string> {
  return (
    field in value &&
    typeof (value as unknown as Record<string, unknown>)[field] === `string`
  )
}

// ============================================================================
// Composer source parsing (slash-command grammar shared by all UIs)
// ============================================================================
//
// These are the single source of truth for the slash-command grammar across
// every composer surface (desktop ProseMirror, mobile native TextInput). The
// inline highlight, the autocomplete trigger, and the emitted payload nodes all
// derive from the patterns below so they cannot silently disagree.

/**
 * Matches a complete slash-command token at a word boundary (e.g. `/pr-review`).
 * Returns a fresh instance per call because the `g` flag is stateful
 * (`lastIndex`) and the same grammar is iterated from multiple call sites.
 */
export const createSlashCommandTokenRegex = (): RegExp =>
  /(^|\s)\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?=\s|$)/g

/**
 * Matches an in-progress slash-command trigger immediately before the cursor
 * (e.g. the user has typed `/pr-rev`). Drives autocomplete. Intentionally more
 * permissive than the token regex (case-insensitive, allows a bare `/`) so the
 * menu can open before a valid command name has been completed. Has no `g` flag,
 * so it is safe to share as a constant.
 */
export const SLASH_COMMAND_TRIGGER_REGEX = /(^|\s)\/([a-z0-9_-]*)$/i

/** An in-progress slash trigger: the query and its source range (`from` is the leading `/`, `to` is the cursor). */
export interface SlashCommandTrigger {
  from: number
  to: number
  query: string
}

/** Detect an in-progress slash trigger ending at `cursor` (a UTF-16 offset into `text`); null if none. */
export function detectSlashCommandTrigger(
  text: string,
  cursor: number
): SlashCommandTrigger | null {
  const textBeforeCursor = text.slice(0, cursor)
  const match = SLASH_COMMAND_TRIGGER_REGEX.exec(textBeforeCursor)
  if (!match) return null
  const query = match[2] ?? ``
  return { from: cursor - query.length - 1, to: cursor, query }
}

/** Strip a leading `/` from a command name, if present. */
export const normalizeCommandName = (name: string): string =>
  name.startsWith(`/`) ? name.slice(1) : name

/**
 * Render a slash command's arguments as a single-line hint for an autocomplete
 * row (e.g. `number: number [include_tests]: boolean`). Required arguments are
 * bare, optional ones are wrapped in brackets, and non-string types are
 * annotated. Returns an empty string for commands without arguments.
 */
export function formatSlashCommandArgumentHint(
  command: SlashCommandRow
): string {
  if (command.arguments && command.arguments.length > 0) {
    return command.arguments
      .map((arg) => {
        const label = arg.required ? arg.name : `[${arg.name}]`
        return arg.type === `string` ? label : `${label}: ${arg.type}`
      })
      .join(` `)
  }

  return ``
}

/**
 * Parse a raw composer source string into a {@link ComposerInputPayload},
 * emitting one `slash_command` node per recognized token. Commands not present
 * in `slashCommands` are still emitted but flagged `unknown` for handler-side
 * interpretation. This is the regex-based producer used by the mobile native
 * composer and as the desktop fallback; the desktop ProseMirror composer also
 * derives nodes from its document and merges the two.
 */
export function serializeComposerInput(
  source: string,
  slashCommands: Array<SlashCommandRow> = []
): ComposerInputPayload {
  const knownNames = new Set(
    slashCommands.map((command) => normalizeCommandName(command.name))
  )
  const nodes: ComposerInputPayload[`nodes`] = []
  const commandPattern = createSlashCommandTokenRegex()
  let match: RegExpExecArray | null

  while ((match = commandPattern.exec(source)) !== null) {
    const prefix = match[1] ?? ``
    const raw = `/${match[2]}`
    const start = match.index + prefix.length
    const name = match[2]

    nodes.push({
      kind: `slash_command`,
      start,
      end: start + raw.length,
      raw,
      name,
      ...(knownNames.has(name) ? {} : { unknown: true }),
    })
  }

  return nodes.length > 0 ? { source, nodes } : { source }
}
