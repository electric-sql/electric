"use client"

import "./Example.css"
import { useEffect, useRef, useState } from "react"

import * as Y from "yjs"
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next"
import { ElectricProvider } from "./y-electric"
import { IndexeddbPersistence } from "y-indexeddb"
import * as awarenessProtocol from "y-protocols/awareness"

import { EditorState, EditorView, basicSetup } from "@codemirror/basic-setup"
import { keymap } from "@codemirror/view"
import { javascript } from "@codemirror/lang-javascript"

import * as random from "lib0/random"

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

const theme = EditorView.theme(
  {
    ".cm-content": {
      minWidth: `400px`,
      textAlign: `left`,
      backgroundColor: `#223239`,
    },
    ".cm-content .cm-gutter": {
      minHeight: `200px`,
    },
  },
  { dark: true }
)
const ydoc = new Y.Doc()

const opts = {
  connect: true,
  awareness: new awarenessProtocol.Awareness(ydoc),
  persistence: new IndexeddbPersistence(room, ydoc),
}
const network = new ElectricProvider(`http://localhost:3000/`, room, ydoc, opts)

export default function Home() {
  const editor = useRef(null)

  const [connect, setConnect] = useState(`connected`)

  const toggle = () => {
    if (connect === `connected`) {
      network?.disconnect()
      setConnect(`disconnected`)
    } else {
      network?.connect()
      setConnect(`connected`)
    }
  }

  useEffect(() => {
    const ytext = ydoc.getText(room)

    network.awareness.setLocalStateField(`user`, {
      name: userColor.color,
      color: userColor.color,
      colorLight: userColor.light,
    })

    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        keymap.of([...yUndoManagerKeymap]),
        basicSetup,
        javascript(),
        EditorView.lineWrapping,
        yCollab(ytext, network.awareness),
        theme,
      ],
    })

    const view = new EditorView({ state, parent: editor.current ?? undefined })

    return () => view.destroy()
  })

  return (
    <div>
      <form action={async () => toggle()}>
        <button type="submit" className="button" name="intent" value="add">
          {connect}
        </button>
      </form>
      <div className="App-editor" ref={editor}></div>
    </div>
  )
}
