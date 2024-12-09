"use client"

import { useEffect, useRef, useState } from "react"

import * as Y from "yjs"
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next"
import { ElectricProvider } from "./y-electric"
import { Awareness } from "y-protocols/awareness"

import { EditorState } from "@codemirror/state"
import { EditorView, basicSetup } from "codemirror"
import { keymap } from "@codemirror/view"
import { javascript } from "@codemirror/lang-javascript"

import * as random from "lib0/random"
import { IndexeddbPersistence } from "y-indexeddb"

const room = `electric-demo`

const usercolors = [
  { color: `#30bced`, light: `#30bced33` },
  { color: `#6eeb83`, light: `#6eeb8333` },
  { color: `#ffbc42`, light: `#ffbc4233` },
  { color: `#ecd444`, light: `#ecd44433` },
  { color: `#ee6352`, light: `#ee635233` },
  { color: `#9ac2c9`, light: `#9ac2c933` },
]

const userColor = usercolors[random.uint32() % usercolors.length]
const ydoc = new Y.Doc()

const isServer = typeof window === `undefined`

const awareness = !isServer ? new Awareness(ydoc) : undefined
awareness?.setLocalStateField(`user`, {
  name: userColor.color,
  color: userColor.color,
  colorLight: userColor.light,
})

const network = !isServer
  ? new ElectricProvider(
      new URL(`/shape-proxy`, window?.location.origin).href,
      room,
      ydoc,
      {
        connect: true,
        awareness,
        persistence: new IndexeddbPersistence(room, ydoc),
      }
    )
  : undefined

export default function ElectricEditor() {
  const editor = useRef(null)

  const [connectivityStatus, setConnectivityStatus] = useState<
    `connected` | `disconnected`
  >(`connected`)

  const toggle = () => {
    if (!network) {
      return
    }
    const toggleStatus =
      connectivityStatus === `connected` ? `disconnected` : `connected`
    setConnectivityStatus(toggleStatus)
    toggleStatus === `connected` ? network.connect() : network.disconnect()
  }

  useEffect(() => {
    if (typeof window === `undefined`) {
      return
    }

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

    return () => view.destroy()
  })

  return (
    <div>
      <form action={async () => toggle()}>
        <button type="submit" className="button" name="intent" value="add">
          {connectivityStatus}
        </button>
      </form>
      <p>
        This is a demo of <a href="https://github.com/yjs/yjs">Yjs</a> using
        {` `}
        {` `}
        <a href="https://github.com/electric-sql/electric">Electric</a> for
        syncing.
      </p>
      <p>
        The content of this editor is shared with every client that visits this
        domain.
      </p>
      <div ref={editor}></div>
    </div>
  )
}
