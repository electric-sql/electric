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
import LocalStorageResumeStateProvider from "../local-storage-persistence"
import { ElectricProviderOptions, ConnectivityStatus } from "../types"

import * as decoding from "lib0/decoding"

type DocumentUpdateRow = {
  op: decoding.Decoder
}

type AwarenessUpdateRow = {
  op: decoding.Decoder
}

const usercolors = [
  { color: `#30bced`, light: `#30bced33` },
  { color: `#6eeb83`, light: `#6eeb8333` },
  { color: `#ffbc42`, light: `#ffbc4233` },
  { color: `#ecd444`, light: `#ecd44433` },
  { color: `#ee6352`, light: `#ee635233` },
  { color: `#9ac2c9`, light: `#9ac2c933` },
]

const user = usercolors[random.uint32() % usercolors.length]
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

const shapesEndpoint = new URL(`/shape-proxy/v1/shape`, window?.location.origin)
const operationSendUrl = new URL(
  `/api/operation?room=${room}`,
  window?.location.origin
)
const awarenessSendUrl = new URL(
  `/api/operation?room=${room}&client_id=${user.color}`,
  window?.location.origin
)

function ElectricEditor({
  electricProviderOptions,
}: {
  electricProviderOptions: ElectricProviderOptions<
    DocumentUpdateRow,
    AwarenessUpdateRow
  >
}) {
  const [docLoaded, setDocLoaded] = useState<boolean>(false)
  const editor = useRef(null)
  const provider = useRef<ElectricProvider<
    DocumentUpdateRow,
    AwarenessUpdateRow
  > | null>(null)
  const [connectivityStatus, setConnectivityStatus] =
    useState<ConnectivityStatus>(`disconnected`)

  // load document from storage
  useEffect(() => {
    databaseProvider.once(`synced`, () => setDocLoaded(true))
  }, [])

  // setup provider
  useEffect(() => {
    if (!docLoaded) {
      return
    }
    provider.current = new ElectricProvider<
      DocumentUpdateRow,
      AwarenessUpdateRow
    >(electricProviderOptions)
    const resumeStateUnsubscribe = resumeStateProvider.subscribeToResumeState(
      provider.current
    )

    const statusHandler = provider.current.on(
      `status`,
      (status: { status: `connected` | `disconnected` | `connecting` }) => {
        setConnectivityStatus(status.status)
      }
    )

    return () => {
      resumeStateUnsubscribe()
      provider.current!.off(`status`, statusHandler)
      provider.current!.destroy()
      provider.current = null
    }
  }, [provider.current])

  // setup editor
  useEffect(() => {
    if (!editor.current) {
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

    const view = new EditorView({ state, parent: editor.current })

    return () => view.destroy()
  }, [editor.current])

  const toggleNetwork = () => {
    if (!provider.current) return

    if (connectivityStatus === `connected`) {
      provider.current.disconnect()
    } else {
      provider.current.connect()
    }
  }

  if (!provider.current) {
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
  const electricProviderOptions: ElectricProviderOptions<
    DocumentUpdateRow,
    AwarenessUpdateRow
  > = {
    doc: ydoc,
    documentUpdates: {
      shape: {
        url: shapesEndpoint.href,
        params: {
          table: `ydoc_operations`,
          where: `room = '${room}'`,
        },
        parser: parseToDecoder,
      },
      sendUrl: operationSendUrl,
      getUpdateFromRow: (row) => row.op,
    },
    awarenessUpdates: {
      shape: {
        url: shapesEndpoint.href,
        params: {
          table: `ydoc_awareness`,
          where: `room = '${room}'`,
        },
        parser: parseToDecoder,
      },
      sendUrl: awarenessSendUrl,
      protocol: awareness,
      getUpdateFromRow: (row) => row.op,
    },
    resumeState: resumeStateProvider.load(),
  }

  return <ElectricEditor electricProviderOptions={electricProviderOptions} />
}
