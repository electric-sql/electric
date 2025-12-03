import { useEffect, useRef, useState } from "react"

import * as Y from "yjs"
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next"
import {
  ElectricProvider,
  ElectricProviderOptions,
  LocalStorageResumeStateProvider,
} from "@electric-sql/y-electric"
import { Awareness } from "y-protocols/awareness"

import { EditorState } from "@codemirror/state"
import { EditorView, basicSetup } from "codemirror"
import { keymap } from "@codemirror/view"
import { javascript } from "@codemirror/lang-javascript"

import * as random from "lib0/random"
import { IndexeddbPersistence } from "y-indexeddb"
import { parseToDecoder } from "../common/utils"

import * as decoding from "lib0/decoding"

type UpdateTableSchema = {
  update: decoding.Decoder
}

const serverUrl = import.meta.env.VITE_SERVER_URL || `http://localhost:3002`

const users = [
  { color: `#30bced`, light: `#30bced33` },
  { color: `#6eeb83`, light: `#6eeb8333` },
  { color: `#ffbc42`, light: `#ffbc4233` },
  { color: `#ecd444`, light: `#ecd44433` },
  { color: `#ee6352`, light: `#ee635233` },
  { color: `#9ac2c9`, light: `#9ac2c933` },
]
const user = users[random.uint32() % users.length]

const shapeUrl = new URL(`/shape-proxy/v1/shape`, serverUrl)
const room = `electric-demo`

const ydoc = new Y.Doc()
const awareness = new Awareness(ydoc)

awareness.setLocalStateField(`user`, {
  name: user.color,
  color: user.color,
  colorLight: user.light,
})

const databaseProvider = new IndexeddbPersistence(user.color, ydoc)
const resumeStateProvider = new LocalStorageResumeStateProvider(user.color)

const options: ElectricProviderOptions<UpdateTableSchema, UpdateTableSchema> = {
  doc: ydoc,
  documentUpdates: {
    shape: {
      url: shapeUrl.href,
      params: {
        table: `ydoc_update`,
        where: `room = '${room}'`,
      },
      parser: parseToDecoder,
      liveSse: true, // Need to run with HTTPs for local development
    },
    sendUrl: new URL(`/api/update?room=${room}`, serverUrl),
    getUpdateFromRow: (row) => row.update,
  },
  awarenessUpdates: {
    shape: {
      url: shapeUrl.href,
      params: {
        table: `ydoc_awareness`,
        where: `room = '${room}'`,
      },
      parser: parseToDecoder,
      liveSse: true,
    },
    sendUrl: new URL(
      `/api/update?room=${room}&client_id=${ydoc.clientID}`,
      serverUrl
    ),
    protocol: awareness,
    getUpdateFromRow: (row) => row.update,
  },
  resumeState: resumeStateProvider.load(),
  debounceMs: 100,
}

function ElectricEditor({
  options,
}: {
  options: ElectricProviderOptions<UpdateTableSchema, UpdateTableSchema>
}) {
  const editor = useRef(null)
  const provider = useRef<ElectricProvider | null>(null)
  const [connectivityStatus, setConnectivityStatus] = useState<
    `connected` | `disconnected` | `connecting`
  >(`disconnected`)
  const [docLoaded, setDocumentLoaded] = useState<boolean>(false)
  const editorViewRef = useRef<EditorView | null>(null)

  const statusHandler = (status: {
    status: `connected` | `disconnected` | `connecting`
  }) => {
    setConnectivityStatus(status.status)
  }

  useEffect(() => {
    databaseProvider.once(`synced`, () => setDocumentLoaded(true))

    let resumeStateUnsubscribeHandler: (() => void) | undefined
    let view: EditorView | undefined

    if (docLoaded) {
      provider.current = new ElectricProvider(options)
      resumeStateUnsubscribeHandler =
        resumeStateProvider.subscribeToResumeState(provider.current)
      provider.current.on(`status`, statusHandler)

      if (editor.current) {
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

        view = new EditorView({ state, parent: editor.current })
        editorViewRef.current = view
      }
    }

    return () => {
      if (provider.current) {
        provider.current.off(`status`, statusHandler)
        provider.current.destroy()
        provider.current = null
        if (resumeStateUnsubscribeHandler) {
          resumeStateUnsubscribeHandler()
        }
      }

      if (editorViewRef.current) {
        editorViewRef.current.destroy()
        editorViewRef.current = null
      }
    }
  }, [docLoaded, editor.current])

  const toggleNetwork = () => {
    if (!provider.current) return

    if (connectivityStatus === `connected`) {
      provider.current.disconnect()
    } else {
      provider.current.connect()
    }
  }

  if (!docLoaded) {
    return <span>Loading...</span>
  }

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          toggleNetwork()
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

export default function Page() {
  return <ElectricEditor options={options} />
}
