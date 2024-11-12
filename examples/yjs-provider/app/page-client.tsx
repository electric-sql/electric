"use client"

import { useEffect, useRef, useState } from "react"

import * as Y from "yjs"
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next"
import { ElectricProvider } from "./y-electric"
import * as awarenessProtocol from "y-protocols/awareness"

import { EditorState } from "@codemirror/state"
import { EditorView, basicSetup } from "codemirror"
import { keymap } from "@codemirror/view"
import { javascript } from "@codemirror/lang-javascript"

import * as random from "lib0/random"
import * as decoding from "lib0/decoding"

import { ShapeData } from "./ydoc-shape"
import { fromBase64 } from "lib0/buffer"

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
let network: ElectricProvider | null = null

export default function Home({ shapeData }: { shapeData: ShapeData }) {
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
    if (typeof window === `undefined`) {
      return
    }

    if (typeof window !== `undefined` && network === null) {
      const awareness = new awarenessProtocol.Awareness(ydoc)

      const { doc, offset, shapeHandle } = shapeData

      const decoder = decoding.createDecoder(fromBase64(doc))
      decoding.readVarUint(decoder)
      Y.applyUpdate(ydoc, decoding.readVarUint8Array(decoder), `server`)

      const opts = {
        connect: true,
        awareness,
        resume: { operations: { offset, shapeHandle } },
      }

      network = new ElectricProvider(`http://localhost:3000/`, room, ydoc, opts)
    }

    const ytext = ydoc.getText(room)

    network?.awareness.setLocalStateField(`user`, {
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
        yCollab(ytext, network?.awareness),
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
      <p>
        This is a demo of <a href="https://github.com/yjs/yjs">Yjs</a> shared
        editor synching with {` `}
        <a href="https://github.com/electric-sql/electric">Electric</a>.
      </p>
      <div ref={editor}></div>
    </div>
  )
}