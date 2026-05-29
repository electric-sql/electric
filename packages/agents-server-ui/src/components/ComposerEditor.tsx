import {
  ProseMirror,
  ProseMirrorDoc,
  reactKeys,
  useEditorEffect,
  useEditorEventCallback,
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
import { Popover } from '../ui'

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
    slash_command: {
      inline: true,
      group: `inline`,
      atom: true,
      selectable: true,
      attrs: {
        name: {},
      },
      parseDOM: [
        {
          tag: `span[data-composer-node="slash_command"]`,
          getAttrs: (node) => {
            if (!(node instanceof HTMLElement)) return false
            const name = node.getAttribute(`data-name`)
            return name ? { name } : false
          },
        },
      ],
      toDOM: (node) => {
        const name = String(node.attrs.name)
        return [
          `span`,
          {
            class: styles.slashCommandPill,
            'data-composer-node': `slash_command`,
            'data-name': name,
            contenteditable: `false`,
          },
          `/${name}`,
        ]
      },
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

interface DismissedSlashQuery extends SlashQuery {}

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
      } else if (node.type.name === `slash_command`) {
        parts.push(`/${String(node.attrs.name)}`)
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

const serializeComposerInputFromDoc = (
  doc: ProseMirrorNode,
  slashCommands: Array<SlashCommandRow> = []
): ComposerInputPayload => {
  const sourceParts: Array<string> = []
  const nodes: ComposerInputPayload[`nodes`] = []

  doc.forEach((paragraph, _offset, paragraphIndex) => {
    if (paragraphIndex > 0) sourceParts.push(`\n`)

    paragraph.forEach((node) => {
      if (node.isText) {
        sourceParts.push(node.text ?? ``)
        return
      }

      if (node.type.name === `hard_break`) {
        sourceParts.push(`\n`)
        return
      }

      if (node.type.name === `slash_command`) {
        const name = normalizeCommandName(String(node.attrs.name))
        const raw = `/${name}`
        const start = sourceParts.join(``).length
        sourceParts.push(raw)
        nodes.push({
          kind: `slash_command`,
          start,
          end: start + raw.length,
          raw,
          name,
        })
      }
    })
  })

  const source = sourceParts.join(``)
  const regexPayload = serializeComposerInput(source, slashCommands)
  const mergedNodes = [...nodes, ...(regexPayload.nodes ?? [])]
    .filter(
      (node, index, allNodes) =>
        allNodes.findIndex(
          (candidate) =>
            candidate.kind === node.kind &&
            candidate.start === node.start &&
            candidate.end === node.end
        ) === index
    )
    .sort((left, right) => left.start - right.start)

  return mergedNodes.length > 0 ? { source, nodes: mergedNodes } : { source }
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
  dismissAutocomplete,
  selectedCommand,
  setSelectedIndex,
  slashCommands,
  slashQuery,
  submit,
}: {
  autocompleteOpen: boolean
  disabled: boolean
  dismissAutocomplete: (query: SlashQuery) => void
  selectedCommand: SlashCommandRow | undefined
  setSelectedIndex: Dispatch<SetStateAction<number>>
  slashCommands: Array<SlashCommandRow>
  slashQuery: SlashQuery | null
  submit: (doc?: ProseMirrorNode) => void
}) {
  const keyboardStateRef = useRef({
    autocompleteOpen,
    disabled,
    dismissAutocomplete,
    selectedCommand,
    slashCommands,
    slashQuery,
  })

  useEffect(() => {
    keyboardStateRef.current = {
      autocompleteOpen,
      disabled,
      dismissAutocomplete,
      selectedCommand,
      slashCommands,
      slashQuery,
    }
  }, [
    autocompleteOpen,
    disabled,
    dismissAutocomplete,
    selectedCommand,
    slashCommands,
    slashQuery,
  ])

  const deleteSlashCommandBeforeCursor = useEditorEventCallback((view) => {
    if (!view) return false
    const { selection, doc } = view.state
    if (!selection.empty) return false

    const cursor = selection.from
    const beforeCursor = doc.resolve(cursor)
    const maybeSpace = beforeCursor.nodeBefore
    const hasTrailingSpace =
      maybeSpace?.isText && maybeSpace.text === ` ` && cursor > 1
    const atomCursor = hasTrailingSpace ? cursor - 1 : cursor
    const atomBefore = doc.resolve(atomCursor).nodeBefore

    if (atomBefore?.type.name !== `slash_command`) {
      return false
    }

    const from = atomCursor - atomBefore.nodeSize
    const to = hasTrailingSpace ? cursor : atomCursor
    view.dispatch(view.state.tr.delete(from, to).scrollIntoView())
    return true
  })

  const insertSlashCommand = useEditorEventCallback(
    (view, command: SlashCommandRow) => {
      const currentSlashQuery = keyboardStateRef.current.slashQuery
      if (!view || !currentSlashQuery) return

      const name = normalizeCommandName(command.name)
      const commandNode = view.state.schema.nodes.slash_command?.create({
        name,
      })
      if (!commandNode) return
      const transaction = view.state.tr.replaceWith(
        currentSlashQuery.from,
        currentSlashQuery.to,
        [commandNode, view.state.schema.text(` `)]
      )
      transaction.setSelection(
        TextSelection.create(transaction.doc, currentSlashQuery.from + 2)
      )

      view.dispatch(transaction)
      view.focus()
    }
  )

  useEditorEffect((view) => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const current = keyboardStateRef.current

      if (current.disabled) {
        event.preventDefault()
        return
      }

      if (current.autocompleteOpen && current.slashQuery) {
        if (event.key === `ArrowDown`) {
          event.preventDefault()
          event.stopPropagation()
          setSelectedIndex(
            (index) => (index + 1) % current.slashCommands.length
          )
          return
        }

        if (event.key === `ArrowUp`) {
          event.preventDefault()
          event.stopPropagation()
          setSelectedIndex(
            (index) =>
              (index - 1 + current.slashCommands.length) %
              current.slashCommands.length
          )
          return
        }

        if (event.key === `Enter`) {
          event.preventDefault()
          event.stopPropagation()
          const command = current.selectedCommand
          const selectedName = command
            ? normalizeCommandName(command.name)
            : null
          if (selectedName === current.slashQuery.query) {
            submit(view.state.doc)
          } else if (command) {
            insertSlashCommand(command)
          }
          return
        }

        if (event.key === `Tab`) {
          event.preventDefault()
          event.stopPropagation()
          const command = current.selectedCommand
          if (command) insertSlashCommand(command)
          return
        }

        if (event.key === `Escape`) {
          event.preventDefault()
          event.stopPropagation()
          current.dismissAutocomplete(current.slashQuery)
          setSelectedIndex(0)
          view.focus()
          return
        }
      }

      if (event.key === `Backspace` && deleteSlashCommandBeforeCursor()) {
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (event.key === `Enter` && !event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        submit(view.state.doc)
        return
      }

      if (event.key === `Enter` && event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        const { hard_break: hardBreak } = view.state.schema.nodes
        if (!hardBreak) return
        const transaction = view.state.tr.replaceSelectionWith(
          hardBreak.create()
        )
        view.dispatch(transaction.scrollIntoView())
        return
      }
    }

    view.dom.addEventListener(`keydown`, handleKeyDown, { capture: true })
    return () => {
      view.dom.removeEventListener(`keydown`, handleKeyDown, { capture: true })
    }
  }, [])

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
      const commandNode = view.state.schema.nodes.slash_command?.create({
        name,
      })
      if (!commandNode) return
      const transaction = view.state.tr.replaceWith(
        slashQuery.from,
        slashQuery.to,
        [commandNode, view.state.schema.text(` `)]
      )
      transaction.setSelection(
        TextSelection.create(transaction.doc, slashQuery.from + 2)
      )

      view.dispatch(transaction)
      view.focus()
    }
  )
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)

  useEditorEffect(
    (view) => {
      if (commands.length === 0 || !slashQuery) {
        setAnchorRect(null)
        return
      }

      const fromRect = view.coordsAtPos(slashQuery.from)
      const toRect = view.coordsAtPos(slashQuery.to)
      setAnchorRect(
        new DOMRect(
          fromRect.left,
          fromRect.top,
          Math.max(1, toRect.right - fromRect.left),
          Math.max(1, fromRect.bottom - fromRect.top)
        )
      )
    },
    [commands.length, slashQuery?.from, slashQuery?.to]
  )

  if (commands.length === 0 || !anchorRect) return null

  const anchor = {
    getBoundingClientRect: () => anchorRect,
  }

  return (
    <Popover.Root open modal={false}>
      <Popover.Content
        side="top"
        align="start"
        sideOffset={8}
        anchor={anchor}
        className={styles.slashPopover}
        padded={false}
        initialFocus={false}
        finalFocus={false}
      >
        <div className={styles.slashList} role="listbox">
          {commands.map((command, index) => {
            const name = normalizeCommandName(command.name)
            return (
              <div
                key={command.key ?? `${command.source}:${name}`}
                role="option"
                aria-selected={index === selectedIndex}
                id={`slash-command-${name}`}
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
              </div>
            )
          })}
        </div>
      </Popover.Content>
    </Popover.Root>
  )
}

const sameSlashQuery = (
  left: SlashQuery | null,
  right: DismissedSlashQuery | null
): boolean =>
  Boolean(
    left &&
      right &&
      left.from === right.from &&
      left.to === right.to &&
      left.query === right.query
  )

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
  const [dismissedSlashQuery, setDismissedSlashQuery] =
    useState<DismissedSlashQuery | null>(null)
  const lastSyncedValueRef = useRef(value)
  const lastNotifiedValueRef = useRef(value)

  const rawSlashQuery = useMemo(() => getSlashQuery(editorState), [editorState])
  const slashQuery = sameSlashQuery(rawSlashQuery, dismissedSlashQuery)
    ? null
    : rawSlashQuery
  const matchingCommands = useMemo(() => {
    if (!slashQuery) return []
    const query = slashQuery.query.toLowerCase()
    return slashCommands
      .filter((command) =>
        normalizeCommandName(command.name).toLowerCase().startsWith(query)
      )
      .slice(0, 8)
  }, [slashCommands, slashQuery])
  const selectedCommand = matchingCommands[selectedIndex]

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
    if (!rawSlashQuery || rawSlashQuery.query !== dismissedSlashQuery?.query) {
      setDismissedSlashQuery(null)
    }
  }, [dismissedSlashQuery?.query, rawSlashQuery])

  useEffect(() => {
    if (selectedIndex >= matchingCommands.length) {
      setSelectedIndex(0)
    }
  }, [matchingCommands.length, selectedIndex])

  useEffect(() => {
    if (source === lastNotifiedValueRef.current) return
    lastSyncedValueRef.current = source
    lastNotifiedValueRef.current = source
    onChange(source)
  }, [onChange, source])

  const submit = (nextDoc = editorState.doc) => {
    const payload = serializeComposerInputFromDoc(nextDoc, slashCommands)
    const nextSource = payload.source
    const trimmed = nextSource.trim()
    if (!trimmed || disabled) return
    onSubmit?.(payload)
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
          dismissAutocomplete={setDismissedSlashQuery}
          selectedCommand={selectedCommand}
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
