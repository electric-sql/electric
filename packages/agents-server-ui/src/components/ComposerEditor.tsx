import {
  ProseMirror,
  ProseMirrorDoc,
  reactKeys,
  useEditorEventCallback,
  useEditorEventListener,
} from '@handlewithcare/react-prosemirror'
import type {
  ComposerInputPayload,
  SlashCommandRow,
} from '@electric-ax/agents-runtime/client'
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Schema, type Node as ProseMirrorNode } from 'prosemirror-model'
import { EditorState, Plugin, TextSelection } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import 'prosemirror-view/style/prosemirror.css'

import styles from './MessageInput.module.css'

const classNames = (
  ...classes: Array<string | false | null | undefined>
): string => classes.filter(Boolean).join(` `)

const composerSchema = new Schema({
  nodes: {
    doc: { content: `block+` },
    paragraph: {
      content: `inline*`,
      group: `block`,
      parseDOM: [{ tag: `p` }],
      toDOM: () => [`p`, 0],
    },
    text: { group: `inline` },
    hard_break: {
      inline: true,
      group: `inline`,
      selectable: false,
      parseDOM: [{ tag: `br` }],
      toDOM: () => [`br`],
    },
  },
  marks: {},
})

export interface ComposerEditorProps {
  value: string
  onChange: (value: string) => void
  onSubmit?: (payload: ComposerInputPayload) => void
  slashCommands?: Array<SlashCommandRow>
  placeholder?: string
  disabled?: boolean
  className?: string
}

interface SlashQuery {
  from: number
  to: number
  query: string
}

const normalizeCommandName = (name: string): string =>
  name.startsWith(`/`) ? name.slice(1) : name

const createDocFromSource = (source: string): ProseMirrorNode => {
  const paragraphs = source.split(`\n`)
  const paragraphType = composerSchema.nodes.paragraph

  const paragraphNodes = paragraphs.map((paragraph) => {
    const children =
      paragraph.length === 0 ? undefined : [composerSchema.text(paragraph)]
    return paragraphType.create(null, children)
  })

  return composerSchema.nodes.doc.create(null, paragraphNodes)
}

const sourceFromDoc = (doc: ProseMirrorNode): string => {
  const parts: Array<string> = []

  doc.forEach((paragraph, _offset, index) => {
    if (index > 0) parts.push(`\n`)
    paragraph.forEach((node) => {
      if (node.isText) {
        parts.push(node.text ?? ``)
      } else if (node.type.name === `hard_break`) {
        parts.push(`\n`)
      }
    })
  })

  return parts.join(``)
}

export const serializeComposerInput = (
  source: string,
  slashCommands: Array<SlashCommandRow> = []
): ComposerInputPayload => {
  const knownNames = new Set(
    slashCommands.map((command) => normalizeCommandName(command.name))
  )
  const nodes: ComposerInputPayload[`nodes`] = []
  const commandPattern = /(^|\s)\/([a-z][a-z0-9_-]*)(?=\s|$)/g
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

const createDecorationPlugin = (
  slashCommands: Array<SlashCommandRow>
): Plugin =>
  new Plugin({
    props: {
      decorations(state) {
        const knownNames = new Set(
          slashCommands.map((command) => normalizeCommandName(command.name))
        )
        const decorations: Array<Decoration> = []

        state.doc.descendants((node, pos) => {
          if (!node.isText || !node.text) return

          const commandPattern = /(^|\s)\/([a-z][a-z0-9_-]*)(?=\s|$)/g
          let match: RegExpExecArray | null

          while ((match = commandPattern.exec(node.text)) !== null) {
            const prefix = match[1] ?? ``
            const name = match[2]
            const start = pos + match.index + prefix.length
            const end = start + name.length + 1

            decorations.push(
              Decoration.inline(start, end, {
                class: classNames(
                  styles.slashToken,
                  knownNames.has(name)
                    ? styles.slashTokenKnown
                    : styles.slashTokenUnknown
                ),
              })
            )
          }
        })

        return DecorationSet.create(state.doc, decorations)
      },
    },
  })

const getSlashQuery = (state: EditorState): SlashQuery | null => {
  const { selection } = state
  if (!selection.empty) return null

  const cursor = selection.from
  const textBeforeCursor = state.doc.textBetween(0, cursor, `\n`, `\n`)
  const match = /(^|\s)\/([a-z0-9_-]*)$/i.exec(textBeforeCursor)
  if (!match) return null

  const query = match[2] ?? ``
  return {
    from: cursor - query.length - 1,
    to: cursor,
    query,
  }
}

const createEditorState = (
  value: string,
  slashCommands: Array<SlashCommandRow>
): EditorState =>
  EditorState.create({
    doc: createDocFromSource(value),
    schema: composerSchema,
    plugins: [reactKeys(), createDecorationPlugin(slashCommands)],
  })

function ComposerEditorEvents({
  autocompleteOpen,
  disabled,
  selectedIndex,
  setSelectedIndex,
  slashCommands,
  slashQuery,
  submit,
}: {
  autocompleteOpen: boolean
  disabled: boolean
  selectedIndex: number
  setSelectedIndex: Dispatch<SetStateAction<number>>
  slashCommands: Array<SlashCommandRow>
  slashQuery: SlashQuery | null
  submit: (source?: string) => void
}) {
  const insertSlashCommand = useEditorEventCallback(
    (view, command: SlashCommandRow) => {
      if (!view || !slashQuery) return

      const name = normalizeCommandName(command.name)
      const replacement = `/${name} `
      const transaction = view.state.tr.replaceWith(
        slashQuery.from,
        slashQuery.to,
        view.state.schema.text(replacement)
      )
      transaction.setSelection(
        TextSelection.create(
          transaction.doc,
          slashQuery.from + replacement.length
        )
      )

      view.dispatch(transaction)
      view.focus()
    }
  )

  useEditorEventListener(`keydown`, (view, event) => {
    if (disabled) {
      event.preventDefault()
      return true
    }

    if (autocompleteOpen && slashQuery) {
      if (event.key === `ArrowDown`) {
        event.preventDefault()
        setSelectedIndex((selectedIndex + 1) % slashCommands.length)
        return true
      }

      if (event.key === `ArrowUp`) {
        event.preventDefault()
        setSelectedIndex(
          (selectedIndex - 1 + slashCommands.length) % slashCommands.length
        )
        return true
      }

      if (event.key === `Enter` || event.key === `Tab`) {
        event.preventDefault()
        const command = slashCommands[selectedIndex]
        if (command) insertSlashCommand(command)
        return true
      }

      if (event.key === `Escape`) {
        event.preventDefault()
        setSelectedIndex(0)
        return true
      }
    }

    if (event.key === `Enter` && !event.shiftKey) {
      event.preventDefault()
      submit(sourceFromDoc(view.state.doc))
      return true
    }

    if (event.key === `Enter` && event.shiftKey) {
      event.preventDefault()
      const { hard_break: hardBreak } = view.state.schema.nodes
      if (!hardBreak) return true
      const transaction = view.state.tr.replaceSelectionWith(hardBreak.create())
      view.dispatch(transaction.scrollIntoView())
      return true
    }

    return false
  })

  return null
}

function SlashCommandPopover({
  commands,
  selectedIndex,
  setSelectedIndex,
  slashQuery,
}: {
  commands: Array<SlashCommandRow>
  selectedIndex: number
  setSelectedIndex: Dispatch<SetStateAction<number>>
  slashQuery: SlashQuery | null
}) {
  const insertSlashCommand = useEditorEventCallback(
    (view, command: SlashCommandRow) => {
      if (!view || !slashQuery) return

      const name = normalizeCommandName(command.name)
      const replacement = `/${name} `
      const transaction = view.state.tr.replaceWith(
        slashQuery.from,
        slashQuery.to,
        view.state.schema.text(replacement)
      )
      transaction.setSelection(
        TextSelection.create(
          transaction.doc,
          slashQuery.from + replacement.length
        )
      )

      view.dispatch(transaction)
      view.focus()
    }
  )

  if (commands.length === 0) return null

  return (
    <div className={styles.slashPopover} role="listbox">
      {commands.map((command, index) => {
        const name = normalizeCommandName(command.name)
        return (
          <button
            key={command.key ?? `${command.source}:${name}`}
            type="button"
            className={classNames(
              styles.slashOption,
              index === selectedIndex && styles.slashOptionActive
            )}
            onMouseDown={(event) => {
              event.preventDefault()
              setSelectedIndex(index)
              insertSlashCommand(command)
            }}
          >
            <span className={styles.slashOptionName}>/{name}</span>
            {command.description ? (
              <span className={styles.slashOptionDescription}>
                {command.description}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

export function ComposerEditor({
  value,
  onChange,
  onSubmit,
  slashCommands = [],
  placeholder = `Message`,
  disabled = false,
  className,
}: ComposerEditorProps) {
  const [editorState, setEditorState] = useState(() =>
    createEditorState(value, slashCommands)
  )
  const [selectedIndex, setSelectedIndex] = useState(0)
  const lastSyncedValueRef = useRef(value)
  const lastNotifiedValueRef = useRef(value)

  const slashQuery = useMemo(() => getSlashQuery(editorState), [editorState])
  const matchingCommands = useMemo(() => {
    if (!slashQuery) return []
    const query = slashQuery.query.toLowerCase()
    return slashCommands
      .filter((command) =>
        normalizeCommandName(command.name).toLowerCase().startsWith(query)
      )
      .slice(0, 8)
  }, [slashCommands, slashQuery])

  const autocompleteOpen = matchingCommands.length > 0
  const source = useMemo(() => sourceFromDoc(editorState.doc), [editorState])
  const isEmpty = source.length === 0

  useEffect(() => {
    if (value === lastSyncedValueRef.current) return
    setEditorState(createEditorState(value, slashCommands))
    lastSyncedValueRef.current = value
    lastNotifiedValueRef.current = value
  }, [slashCommands, value])

  useEffect(() => {
    setSelectedIndex(0)
  }, [slashQuery?.query])

  useEffect(() => {
    if (source === lastNotifiedValueRef.current) return
    lastSyncedValueRef.current = source
    lastNotifiedValueRef.current = source
    onChange(source)
  }, [onChange, source])

  const submit = (nextSource = source) => {
    const trimmed = nextSource.trim()
    if (!trimmed || disabled) return
    onSubmit?.(serializeComposerInput(nextSource, slashCommands))
  }

  return (
    <div
      className={classNames(styles.proseMirrorWrap, className)}
      data-empty={isEmpty ? `true` : undefined}
      data-placeholder={placeholder}
      data-disabled={disabled ? `true` : undefined}
    >
      <ProseMirror
        state={editorState}
        editable={() => !disabled}
        dispatchTransaction={(transaction) => {
          setEditorState((currentState) => {
            const nextState = currentState.apply(transaction)
            return nextState
          })
        }}
        attributes={{
          class: styles.proseMirrorEditor,
          'aria-label': placeholder,
        }}
      >
        <ProseMirrorDoc />
        <ComposerEditorEvents
          autocompleteOpen={autocompleteOpen}
          disabled={disabled}
          selectedIndex={selectedIndex}
          setSelectedIndex={setSelectedIndex}
          slashCommands={matchingCommands}
          slashQuery={slashQuery}
          submit={submit}
        />
        <SlashCommandPopover
          commands={matchingCommands}
          selectedIndex={selectedIndex}
          setSelectedIndex={setSelectedIndex}
          slashQuery={slashQuery}
        />
      </ProseMirror>
    </div>
  )
}
