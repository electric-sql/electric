import { useEffect, useRef, useState } from "react"

import * as Y from "yjs"
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next"
import { ElectricProvider } from "../y-electric"
import { Awareness } from "y-protocols/awareness"

import { EditorState } from "@codemirror/state"
import { EditorView, basicSetup } from "codemirror"
import { keymap } from "@codemirror/view"
import { javascript } from "@codemirror/lang-javascript"

import * as random from "lib0/random"
import { IndexeddbPersistence } from "y-indexeddb"
import { parseToDecoder } from "../common/utils"
import { LocalStorageResumeStateProvider } from "../local-storage-persistence"

const room = `electric-demo`

const usercolors = [
  { color: `#30bced`, light: `#30bced33` },
  { color: `#6eeb83`, light: `#6eeb8333` },
  { color: `#ffbc42`, light: `#ffbc4233` },
  { color: `#ecd444`, light: `#ecd44433` },
  { color: `#ee6352`, light: `#ee635233` },
  { color: `#9ac2c9`, light: `#9ac2c933` },
]

const user = usercolors[random.uint32() % usercolors.length]
const ydoc = new Y.Doc()

// use database provider
const databaseProvider = new IndexeddbPersistence(room, ydoc)

const awareness = new Awareness(ydoc)
awareness.setLocalStateField(`user`, {
  name: awareness.clientID,
  color: user.color,
  colorLight: user.light,
})

const shapesEndpoint = new URL(`/shape-proxy/v1/shape`, window?.location.origin)
  .href
const endpoints = {
  operations: new URL(`/api/operation?room=${room}`, window?.location.origin)
    .href,
  awareness: new URL(
    `/api/operation?room=${room}&client_id=${ydoc.clientID}`,
    window?.location.origin
  ).href,
}

// This basic example doesn't prevent session conflicts
const resumeStateProvider = new LocalStorageResumeStateProvider(user.color)

const network = new ElectricProvider({
  doc: ydoc,
  operations: {
    options: {
      url: shapesEndpoint,
      params: {
        table: `ydoc_operations`,
        where: `room = '${room}'`,
      },
      parser: parseToDecoder,
    },
    endpoint: endpoints.operations,
  },
  awareness: {
    options: {
      url: shapesEndpoint,
      params: {
        table: `ydoc_awareness`,
        where: `room = '${room}'`,
      },
      parser: parseToDecoder,
    },
    endpoint: endpoints.awareness,
    protocol: awareness!,
  },
  resumeStateProvider,
  databaseProvider,
})

export default function ElectricEditor() {
  const editor = useRef(null)

  const [connectivityStatus, setConnectivityStatus] = useState<
    `connected` | `disconnected` | `connecting`
  >(`disconnected`)

  const toggle = () => {
    const toggleStatus =
      connectivityStatus === `connected` ? `disconnected` : `connected`
    if (toggleStatus === `connected`) {
      network.connect()
    } else {
      network.disconnect()
    }
  }

  useEffect(() => {
    if (typeof window === `undefined`) {
      return
    }

    network.on(`status`, (status) => {
      setConnectivityStatus(status.status)
    })

    const ytext = ydoc.getText(room)

    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        keymap.of([...yUndoManagerKeymap]),
        basicSetup,
        javascript(),
        EditorView.lineWrapping,
        yCollab(ytext, awareness),
      ],
    })

    const view = new EditorView({ state, parent: editor.current ?? undefined })

    return () => {
      view.destroy()
    }
  })

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          toggle()
        }}
      >
        <button type="submit" className="button" name="intent" value="add">
          {connectivityStatus}
        </button>
      </form>
      <p>
        This is a demo of <a href="https://github.com/yjs/yjs">Yjs</a> using
        {` `}
        {` `}
        <a href="https://github.com/electric-sql/electric">Electric</a> for
        syncing. User: {user.color}.
      </p>
      <p>
        The content of this editor is shared with every client that visits this
        domain.
      </p>
      <div ref={editor}></div>
    </div>
  )
}
