import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness'
import * as Y from 'yjs'

export const MARKDOWN_DOCUMENT_TEXT_NAME = `markdown` as const

export function frameYjsUpdate(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint8Array(encoder, update)
  return encoding.toUint8Array(encoder)
}

export function applyFramedYjsUpdates(doc: Y.Doc, data: Uint8Array): void {
  if (data.length === 0) return
  const decoder = decoding.createDecoder(data)
  while (decoding.hasContent(decoder)) {
    Y.applyUpdate(doc, decoding.readVarUint8Array(decoder), `agent`)
  }
}

export function markdownText(
  doc: Y.Doc,
  name: string = MARKDOWN_DOCUMENT_TEXT_NAME
): Y.Text {
  return doc.getText(name)
}

export function createMarkdownYDoc(data: Uint8Array): Y.Doc {
  const doc = new Y.Doc()
  applyFramedYjsUpdates(doc, data)
  return doc
}

export function replaceMarkdownText(
  doc: Y.Doc,
  content: string,
  textName: string = MARKDOWN_DOCUMENT_TEXT_NAME
): Uint8Array {
  const before = Y.encodeStateVector(doc)
  const text = markdownText(doc, textName)
  doc.transact(() => {
    text.delete(0, text.length)
    if (content.length > 0) text.insert(0, content)
  }, `agent`)
  return Y.encodeStateAsUpdate(doc, before)
}

export function editMarkdownText(
  doc: Y.Doc,
  oldString: string,
  newString: string,
  replaceAll: boolean | undefined,
  textName: string = MARKDOWN_DOCUMENT_TEXT_NAME
): {
  update: Uint8Array
  content: string
  replacements: number
  cursorIndex?: number
} {
  const text = markdownText(doc, textName)
  const beforeContent = text.toString()
  const matches = beforeContent.split(oldString).length - 1
  if (matches === 0 || (!replaceAll && matches > 1)) {
    return {
      update: new Uint8Array(),
      content: beforeContent,
      replacements: matches,
    }
  }

  const before = Y.encodeStateVector(doc)
  let cursorIndex = 0
  if (replaceAll) {
    let cursor = 0
    doc.transact(() => {
      while (true) {
        const index = text.toString().indexOf(oldString, cursor)
        if (index < 0) break
        text.delete(index, oldString.length)
        text.insert(index, newString)
        cursor = index + newString.length
        cursorIndex = cursor
      }
    }, `agent`)
  } else {
    const index = beforeContent.indexOf(oldString)
    doc.transact(() => {
      text.delete(index, oldString.length)
      text.insert(index, newString)
    }, `agent`)
    cursorIndex = index + newString.length
  }
  return {
    update: Y.encodeStateAsUpdate(doc, before),
    content: text.toString(),
    replacements: matches,
    cursorIndex,
  }
}

export function insertMarkdownText(
  doc: Y.Doc,
  content: string,
  opts?: {
    index?: number
    position?: Y.RelativePosition
    textName?: string
  }
): {
  update: Uint8Array
  index: number
  nextIndex: number
  nextPosition: Y.RelativePosition
} {
  const text = markdownText(doc, opts?.textName)
  const absolute = opts?.position
    ? Y.createAbsolutePositionFromRelativePosition(opts.position, doc)
    : null
  const index =
    absolute && absolute.type === text
      ? Math.max(0, Math.min(absolute.index, text.length))
      : Math.max(0, Math.min(opts?.index ?? text.length, text.length))
  const before = Y.encodeStateVector(doc)
  if (content.length > 0) {
    doc.transact(() => {
      text.insert(index, content)
    }, `agent`)
  }
  const nextIndex = index + content.length
  return {
    update: Y.encodeStateAsUpdate(doc, before),
    index,
    nextIndex,
    nextPosition: Y.createRelativePositionFromTypeIndex(text, nextIndex),
  }
}

export function deleteMarkdownTextRange(
  doc: Y.Doc,
  index: number,
  length: number,
  textName: string = MARKDOWN_DOCUMENT_TEXT_NAME
): {
  update: Uint8Array
  index: number
  length: number
  position: Y.RelativePosition
} {
  const text = markdownText(doc, textName)
  const boundedIndex = Math.max(0, Math.min(index, text.length))
  const boundedLength = Math.max(
    0,
    Math.min(length, text.length - boundedIndex)
  )
  const before = Y.encodeStateVector(doc)
  if (boundedLength > 0) {
    doc.transact(() => {
      text.delete(boundedIndex, boundedLength)
    }, `agent`)
  }
  return {
    update: Y.encodeStateAsUpdate(doc, before),
    index: boundedIndex,
    length: boundedLength,
    position: Y.createRelativePositionFromTypeIndex(text, boundedIndex),
  }
}

export function relativePositionAtMarkdownIndex(
  doc: Y.Doc,
  index: number,
  textName: string = MARKDOWN_DOCUMENT_TEXT_NAME
): Y.RelativePosition {
  const text = markdownText(doc, textName)
  const boundedIndex = Math.max(0, Math.min(index, text.length))
  return Y.createRelativePositionFromTypeIndex(text, boundedIndex)
}

export function markdownIndexFromRelativePosition(
  doc: Y.Doc,
  position: Y.RelativePosition,
  textName: string = MARKDOWN_DOCUMENT_TEXT_NAME
): number | undefined {
  const text = markdownText(doc, textName)
  const absolute = Y.createAbsolutePositionFromRelativePosition(position, doc)
  if (!absolute || absolute.type !== text) return undefined
  return Math.max(0, Math.min(absolute.index, text.length))
}

export function encodeMarkdownAwarenessUpdate(opts: {
  doc: Y.Doc
  docPath: string
  principalUrl: string
  clientKey?: string
  name: string
  role: `agent` | `user` | `system`
  status?: `editing`
  anchor?: number
  head?: number
  color: string
  colorLight: string
  clear?: boolean
  textName?: string
}): Uint8Array {
  const awarenessDoc = new Y.Doc()
  ;(awarenessDoc as { clientID: number }).clientID =
    markdownDocumentPresenceClientId(
      opts.docPath,
      opts.clientKey ?? opts.principalUrl
    )
  const awareness = new Awareness(awarenessDoc)
  if (opts.clear) {
    awareness.setLocalState(null)
  } else {
    const text = markdownText(opts.doc, opts.textName)
    const anchor = Math.max(
      0,
      Math.min(opts.anchor ?? text.length, text.length)
    )
    const head = Math.max(0, Math.min(opts.head ?? anchor, text.length))
    const now = Date.now()
    awareness.setLocalState({
      user: {
        name: opts.name,
        principalUrl: opts.principalUrl,
        role: opts.role,
        status: opts.status ?? `editing`,
        updatedAt: now,
        expiresAt: now + 5_000,
        color: opts.color,
        colorLight: opts.colorLight,
      },
      cursor: {
        anchor: Y.createRelativePositionFromTypeIndex(text, anchor),
        head: Y.createRelativePositionFromTypeIndex(text, head),
      },
    })
  }
  return frameYjsUpdate(encodeAwarenessUpdate(awareness, [awareness.clientID]))
}

function markdownDocumentPresenceClientId(
  docPath: string,
  principalUrl: string
): number {
  let hash = 2166136261
  const input = `${docPath}\0${principalUrl}`
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  const id = hash >>> 0
  return id === 0 ? 1 : id
}
