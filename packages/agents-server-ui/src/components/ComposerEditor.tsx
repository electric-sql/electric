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
  createSlashCommandTokenRegex,
  formatSlashCommandArgumentHint,
  normalizeCommandName,
  serializeComposerInput,
  SLASH_COMMAND_TRIGGER_REGEX,
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
import { keymap } from 'prosemirror-keymap'
import { deleteSelection, selectAll } from 'prosemirror-commands'
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
    slash_call: {
      inline: true,
      group: `inline`,
      content: `slash_command slash_argument*`,
      isolating: true,
      selectable: false,
      attrs: {},
      parseDOM: [{ tag: `span[data-composer-node="slash_call"]` }],
      toDOM: () => [
        `span`,
        {
          class: styles.slashCall,
          'data-composer-node': `slash_call`,
        },
        0,
      ],
    },
    slash_command: {
      inline: true,
      atom: true,
      selectable: false,
      attrs: {
        // default is unused — every call site creates with a real name — but
        // ProseMirror requires a default so it can synthesise this node when
        // filling the required position in slash_call's content expression.
        name: { default: `` },
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
    slash_argument: {
      inline: true,
      content: `text*`,
      isolating: true,
      selectable: false,
      attrs: {
        name: { default: `` },
        type: { default: `string` },
        required: { default: false },
      },
      parseDOM: [
        {
          tag: `span[data-composer-node="slash_argument"]`,
          getAttrs: (node) => {
            if (!(node instanceof HTMLElement)) return false
            const name = node.getAttribute(`data-name`)
            return name
              ? {
                  name,
                  type: node.getAttribute(`data-type`) ?? `string`,
                  required: node.getAttribute(`data-required`) === `true`,
                }
              : false
          },
        },
      ],
      toDOM: (node) => {
        const name = String(node.attrs.name)
        const type = String(node.attrs.type)
        const required = node.attrs.required === true
        return [
          `span`,
          {
            class: styles.slashArgumentSlot,
            'data-composer-node': `slash_argument`,
            'data-name': name,
            'data-type': type,
            'data-required': required ? `true` : `false`,
          },
          [
            `span`,
            {
              class: styles.slashArgumentValue,
              'data-placeholder': name,
            },
            0,
          ],
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

interface SlashCallInsertPlan {
  nodes: Array<ProseMirrorNode>
  cursorOffset: number
}

const createSlashCommandInsertContent = (
  schema: Schema,
  command: SlashCommandRow
): SlashCallInsertPlan | null => {
  const name = normalizeCommandName(command.name)
  const commandType = schema.nodes.slash_command
  const callType = schema.nodes.slash_call
  const argumentType = schema.nodes.slash_argument
  if (!commandType || !callType) return null

  const commandNode = commandType.create({ name })
  const callChildren: Array<ProseMirrorNode> = [commandNode]
  for (const argument of command.arguments ?? []) {
    if (!argumentType) break
    callChildren.push(
      argumentType.create({
        name: argument.name,
        type: argument.type,
        required: argument.required === true,
      })
    )
  }

  const callNode = callType.create(null, callChildren)
  const hasArguments = (command.arguments ?? []).length > 0
  const trailingSpace = schema.text(` `)

  return {
    nodes: [callNode, trailingSpace],
    // hasArguments: cursor lands at start of the first argument's text content
    //   = enter call (+1) + past command atom (+1) + enter arg (+1)
    // no args: cursor lands after the trailing space
    cursorOffset: hasArguments ? 3 : callNode.nodeSize + 1,
  }
}

const appendSourcePart = (parts: Array<string>, part: string): void => {
  if (
    part.length > 0 &&
    parts.length > 0 &&
    !/\s$/.test(parts[parts.length - 1] ?? ``)
  ) {
    parts.push(` `)
  }
  parts.push(part)
}

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
      } else if (node.type.name === `slash_call`) {
        node.forEach((child) => {
          if (child.type.name === `slash_command`) {
            parts.push(`/${String(child.attrs.name)}`)
          } else if (child.type.name === `slash_argument`) {
            appendSourcePart(parts, child.textContent)
          }
        })
      }
    })
  })

  return parts.join(``)
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

      if (node.type.name === `slash_call`) {
        node.forEach((child) => {
          if (child.type.name === `slash_command`) {
            const name = normalizeCommandName(String(child.attrs.name))
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
          } else if (child.type.name === `slash_argument`) {
            appendSourcePart(sourceParts, child.textContent)
          }
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

const createSlashCallAnchor = (): HTMLElement => {
  const el = document.createElement(`span`)
  el.className = styles.slashCallAnchor
  // Must be explicitly contenteditable=false; otherwise the browser treats
  // the empty span as editable and arrow keys / clicks can park the caret
  // inside it, which then maps back to the same PM position and confuses
  // navigation across the slash_call boundary.
  el.contentEditable = `false`
  el.setAttribute(`aria-hidden`, `true`)
  return el
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
          // Slash-call anchors: tiny non-editable widgets either side of every
          // slash_call so the cursor always has visible space to land in/click
          // on, even when the call is the first or last child of a paragraph.
          if (node.type.name === `slash_call`) {
            decorations.push(
              Decoration.widget(pos, createSlashCallAnchor, {
                side: -1,
                key: `slash-call-anchor-before`,
              })
            )
            decorations.push(
              Decoration.widget(pos + node.nodeSize, createSlashCallAnchor, {
                side: 1,
                key: `slash-call-anchor-after`,
              })
            )
            return false
          }

          if (!node.isText || !node.text) return

          const commandPattern = createSlashCommandTokenRegex()
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
  const match = SLASH_COMMAND_TRIGGER_REGEX.exec(textBeforeCursor)
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
    plugins: [
      reactKeys(),
      keymap({
        'Mod-a': selectAll,
        Backspace: deleteSelection,
        Delete: deleteSelection,
      }),
      createDecorationPlugin(slashCommands),
    ],
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
    submit,
  })

  useEffect(() => {
    keyboardStateRef.current = {
      autocompleteOpen,
      disabled,
      dismissAutocomplete,
      selectedCommand,
      slashCommands,
      slashQuery,
      submit,
    }
  }, [
    autocompleteOpen,
    disabled,
    dismissAutocomplete,
    selectedCommand,
    slashCommands,
    slashQuery,
    submit,
  ])

  const deleteComposerAtomBeforeCursor = useEditorEventCallback((view) => {
    if (!view) return false
    const { selection, doc } = view.state
    if (!selection.empty) return false

    const $cursor = selection.$from

    // Empty argument slot: remove just the slot.
    if (
      $cursor.parent.type.name === `slash_argument` &&
      $cursor.parent.content.size === 0
    ) {
      const from = $cursor.before()
      const to = $cursor.after()
      view.dispatch(view.state.tr.delete(from, to).scrollIntoView())
      return true
    }

    // At the start of a non-empty argument: swallow the backspace so PM
    // doesn't try to merge across the isolating boundary.
    if (
      $cursor.parent.type.name === `slash_argument` &&
      $cursor.parentOffset === 0
    ) {
      return true
    }

    // Inside a slash_call but outside any argument slot: delete the whole call.
    if ($cursor.parent.type.name === `slash_call`) {
      const callStart = $cursor.before()
      const callEnd = $cursor.after()
      const $after = doc.resolve(callEnd)
      const trailing = $after.nodeAfter
      const removeTrailingSpace =
        trailing?.isText === true && trailing.text === ` `
      const to = removeTrailingSpace ? callEnd + 1 : callEnd
      view.dispatch(view.state.tr.delete(callStart, to).scrollIntoView())
      return true
    }

    // Just after a slash_call (optionally past a trailing space): delete the call.
    const cursor = selection.from
    const beforeCursor = doc.resolve(cursor)
    const maybeSpace = beforeCursor.nodeBefore
    const hasTrailingSpace =
      maybeSpace?.isText === true && maybeSpace.text === ` ` && cursor > 1
    const callCursor = hasTrailingSpace ? cursor - 1 : cursor
    const callBefore = doc.resolve(callCursor).nodeBefore

    if (callBefore?.type.name !== `slash_call`) return false

    const from = callCursor - callBefore.nodeSize
    const to = hasTrailingSpace ? cursor : callCursor
    view.dispatch(view.state.tr.delete(from, to).scrollIntoView())
    return true
  })

  const collapseSelectionToSide = useEditorEventCallback(
    (view, direction: `left` | `right`) => {
      if (!view) return false
      const { state } = view
      const { selection, doc } = state
      if (selection.empty) return false
      const target = direction === `left` ? selection.from : selection.to
      const bias = direction === `left` ? -1 : 1
      const next = TextSelection.near(doc.resolve(target), bias)
      view.dispatch(state.tr.setSelection(next).scrollIntoView())
      return true
    }
  )

  const moveCursorAcrossSlot = useEditorEventCallback(
    (view, direction: `left` | `right`) => {
      if (!view) return false
      const { state } = view
      const { selection, doc } = state
      if (!selection.empty) return false
      const $cursor = selection.$from

      if (direction === `right`) {
        // End of an argument: hop to the next slot or exit the call.
        if (
          $cursor.parent.type.name === `slash_argument` &&
          $cursor.parentOffset === $cursor.parent.content.size
        ) {
          const after = $cursor.after()
          const $after = doc.resolve(after)
          const next = $after.nodeAfter
          if (next?.type.name === `slash_argument`) {
            view.dispatch(
              state.tr.setSelection(TextSelection.create(doc, after + 1))
            )
            return true
          }
          const callEnd = $after.after()
          view.dispatch(
            state.tr.setSelection(TextSelection.create(doc, callEnd))
          )
          return true
        }

        // Inside slash_call but outside any arg (e.g. cursor parked between
        // slash_command and the first arg, or right at the end of the call).
        if ($cursor.parent.type.name === `slash_call`) {
          const parent = $cursor.parent
          const start = $cursor.start()
          let nextArgEnter: number | null = null
          let walk = 0
          parent.forEach((child) => {
            if (
              nextArgEnter === null &&
              child.type.name === `slash_argument` &&
              walk >= $cursor.parentOffset
            ) {
              nextArgEnter = start + walk + 1
            }
            walk += child.nodeSize
          })
          if (nextArgEnter !== null) {
            view.dispatch(
              state.tr.setSelection(TextSelection.create(doc, nextArgEnter))
            )
            return true
          }
          view.dispatch(
            state.tr.setSelection(TextSelection.create(doc, $cursor.after()))
          )
          return true
        }

        // Approaching a slash_call from the left: jump into first slot or past it.
        const nodeAfter = $cursor.nodeAfter
        if (nodeAfter?.type.name === `slash_call`) {
          const callStart = $cursor.pos
          let argOffset = -1
          let walk = 0
          nodeAfter.forEach((child) => {
            if (argOffset === -1 && child.type.name === `slash_argument`) {
              argOffset = walk
            }
            walk += child.nodeSize
          })
          if (argOffset !== -1) {
            view.dispatch(
              state.tr.setSelection(
                TextSelection.create(doc, callStart + 1 + argOffset + 1)
              )
            )
            return true
          }
          view.dispatch(
            state.tr.setSelection(
              TextSelection.create(doc, callStart + nodeAfter.nodeSize)
            )
          )
          return true
        }
        return false
      }

      // direction === 'left'
      if (
        $cursor.parent.type.name === `slash_argument` &&
        $cursor.parentOffset === 0
      ) {
        const before = $cursor.before()
        const $before = doc.resolve(before)
        const prev = $before.nodeBefore
        if (prev?.type.name === `slash_argument`) {
          view.dispatch(
            state.tr.setSelection(TextSelection.create(doc, before - 1))
          )
          return true
        }
        const callStart = $before.before()
        view.dispatch(
          state.tr.setSelection(TextSelection.create(doc, callStart))
        )
        return true
      }

      // Inside slash_call but outside any arg: walk back to the end of the
      // nearest preceding arg, or exit before the call if there isn't one.
      if ($cursor.parent.type.name === `slash_call`) {
        const parent = $cursor.parent
        const start = $cursor.start()
        let prevArgEnd: number | null = null
        let walk = 0
        parent.forEach((child) => {
          if (
            child.type.name === `slash_argument` &&
            walk + child.nodeSize <= $cursor.parentOffset
          ) {
            prevArgEnd = start + walk + child.nodeSize - 1
          }
          walk += child.nodeSize
        })
        if (prevArgEnd !== null) {
          view.dispatch(
            state.tr.setSelection(TextSelection.create(doc, prevArgEnd))
          )
          return true
        }
        view.dispatch(
          state.tr.setSelection(TextSelection.create(doc, $cursor.before()))
        )
        return true
      }

      // Approaching a slash_call from the right: jump into last slot or before it.
      const nodeBefore = $cursor.nodeBefore
      if (nodeBefore?.type.name === `slash_call`) {
        const callEnd = $cursor.pos
        const callStart = callEnd - nodeBefore.nodeSize
        let lastArgOffset = -1
        let lastArgSize = 0
        let walk = 0
        nodeBefore.forEach((child) => {
          if (child.type.name === `slash_argument`) {
            lastArgOffset = walk
            lastArgSize = child.nodeSize
          }
          walk += child.nodeSize
        })
        if (lastArgOffset !== -1) {
          const endOfArg = callStart + 1 + lastArgOffset + lastArgSize - 1
          view.dispatch(
            state.tr.setSelection(TextSelection.create(doc, endOfArg))
          )
          return true
        }
        view.dispatch(
          state.tr.setSelection(TextSelection.create(doc, callStart))
        )
        return true
      }
      return false
    }
  )

  const insertSlashCommand = useEditorEventCallback(
    (view, command: SlashCommandRow) => {
      const currentSlashQuery = keyboardStateRef.current.slashQuery
      if (!view || !currentSlashQuery) return

      const plan = createSlashCommandInsertContent(view.state.schema, command)
      if (!plan) return
      const transaction = view.state.tr.replaceWith(
        currentSlashQuery.from,
        currentSlashQuery.to,
        plan.nodes
      )
      transaction.setSelection(
        TextSelection.create(
          transaction.doc,
          currentSlashQuery.from + plan.cursorOffset
        )
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
          if (
            selectedName === current.slashQuery.query &&
            !(command!.arguments && command!.arguments.length > 0)
          ) {
            current.submit(view.state.doc)
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

      if (event.key === `Backspace` && deleteComposerAtomBeforeCursor()) {
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (
        event.key === `ArrowRight` &&
        (collapseSelectionToSide(`right`) || moveCursorAcrossSlot(`right`))
      ) {
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (
        event.key === `ArrowLeft` &&
        (collapseSelectionToSide(`left`) || moveCursorAcrossSlot(`left`))
      ) {
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (event.key === `Enter` && !event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        current.submit(view.state.doc)
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

      const plan = createSlashCommandInsertContent(view.state.schema, command)
      if (!plan) return
      const transaction = view.state.tr.replaceWith(
        slashQuery.from,
        slashQuery.to,
        plan.nodes
      )
      transaction.setSelection(
        TextSelection.create(
          transaction.doc,
          slashQuery.from + plan.cursorOffset
        )
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
            const argumentHint = formatSlashCommandArgumentHint(command)
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
                <span className={styles.slashOptionName}>
                  /{name}
                  {argumentHint ? (
                    <span className={styles.slashOptionArguments}>
                      {` `}
                      {argumentHint}
                    </span>
                  ) : null}
                </span>
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

  const lastSlashCommandsRef = useRef(slashCommands)

  useEffect(() => {
    const valueChanged = value !== lastSyncedValueRef.current
    const commandsChanged = slashCommands !== lastSlashCommandsRef.current
    lastSlashCommandsRef.current = slashCommands

    if (valueChanged) {
      setEditorState(createEditorState(value, slashCommands))
      lastSyncedValueRef.current = value
      lastNotifiedValueRef.current = value
    } else if (commandsChanged) {
      setEditorState((prev) =>
        prev.reconfigure({
          plugins: [
            reactKeys(),
            keymap({
              'Mod-a': selectAll,
              Backspace: deleteSelection,
              Delete: deleteSelection,
            }),
            createDecorationPlugin(slashCommands),
          ],
        })
      )
    }
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
