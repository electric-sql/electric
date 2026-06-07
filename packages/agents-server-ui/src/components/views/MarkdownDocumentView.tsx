import { useEffect, useMemo, useRef, useState } from 'react'
import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView, basicSetup } from 'codemirror'
import { keymap } from '@codemirror/view'
import { YjsProvider } from '@durable-streams/y-durable-streams'
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { useCurrentPrincipal } from '../../hooks/useCurrentPrincipal'
import { getConfiguredServerHeaders, serverFetch } from '../../lib/auth-fetch'
import { principalKeyFromInput } from '../../lib/principals'
import styles from './MarkdownDocumentView.module.css'
import type { EntityViewProps } from '../../lib/workspace/viewRegistry'
import type { ManifestDocumentEntry } from '@electric-ax/agents-runtime/client'

type DocumentResponse = {
  document: ManifestDocumentEntry
  content: string
}

function entityApiUrl(baseUrl: string, entityUrl: string, suffix: string): URL {
  const url = new URL(baseUrl)
  url.pathname = `${url.pathname.replace(/\/+$/, ``)}/_electric/entities${entityUrl}${suffix}`
  return url
}

function colorFor(value: string): { color: string; light: string } {
  const colors = [
    [`#2563eb`, `#2563eb33`],
    [`#059669`, `#05966933`],
    [`#dc2626`, `#dc262633`],
    [`#7c3aed`, `#7c3aed33`],
    [`#c2410c`, `#c2410c33`],
    [`#0f766e`, `#0f766e33`],
  ] as const
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  const [color, light] = colors[hash % colors.length]!
  return { color, light }
}

function providerBaseUrl(baseUrl: string, streamPath: string): string {
  const docsIndex = streamPath.indexOf(`/docs/`)
  const prefix = docsIndex >= 0 ? streamPath.slice(0, docsIndex) : streamPath
  const url = new URL(baseUrl)
  url.pathname = `${url.pathname.replace(/\/+$/, ``)}${prefix}`
  return url.toString().replace(/\/+$/, ``)
}

export function MarkdownDocumentView({
  baseUrl,
  entityUrl,
  viewParams,
}: EntityViewProps): React.ReactElement {
  const documentId = viewParams?.doc ?? null
  const editorRef = useRef<HTMLDivElement | null>(null)
  const editorViewRef = useRef<EditorView | null>(null)
  const [documentEntry, setDocumentEntry] =
    useState<ManifestDocumentEntry | null>(null)
  const [status, setStatus] = useState<
    `loading` | `connecting` | `connected` | `disconnected` | `error`
  >(`loading`)
  const [remoteUsers, setRemoteUsers] = useState<Array<string>>([])
  const { principal } = useCurrentPrincipal()

  useEffect(() => {
    let cancelled = false
    setDocumentEntry(null)
    setStatus(documentId ? `loading` : `error`)
    if (!documentId) return
    const url = entityApiUrl(
      baseUrl,
      entityUrl,
      `/documents/${encodeURIComponent(documentId)}`
    )
    serverFetch(url, { headers: { accept: `application/json` } })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Document request failed (${response.status})`)
        }
        return (await response.json()) as DocumentResponse
      })
      .then((result) => {
        if (!cancelled) setDocumentEntry(result.document)
      })
      .catch(() => {
        if (!cancelled) setStatus(`error`)
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl, entityUrl, documentId])

  const principalLabel = useMemo(
    () => principalKeyFromInput(principal) ?? principal,
    [principal]
  )

  useEffect(() => {
    if (!editorRef.current || !documentEntry) return

    const ydoc = new Y.Doc()
    const awareness = new Awareness(ydoc)
    const userColor = colorFor(principalLabel)
    awareness.setLocalStateField(`user`, {
      name: principalLabel,
      color: userColor.color,
      colorLight: userColor.light,
    })

    const docUrl = new URL(
      `${providerBaseUrl(baseUrl, documentEntry.streamPath)}/docs/${documentEntry.docPath}`
    )
    const provider = new YjsProvider({
      doc: ydoc,
      baseUrl: providerBaseUrl(baseUrl, documentEntry.streamPath),
      docId: documentEntry.docPath,
      awareness,
      headers: getConfiguredServerHeaders(docUrl),
      liveMode: `sse`,
    })
    const ytext = ydoc.getText(`markdown`)
    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        keymap.of([...yUndoManagerKeymap]),
        basicSetup,
        markdown(),
        EditorView.lineWrapping,
        yCollab(ytext, awareness),
      ],
    })
    const view = new EditorView({ state, parent: editorRef.current })
    editorViewRef.current = view

    const updateRemoteUsers = (): void => {
      const names: Array<string> = []
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === awareness.clientID) return
        const user = (state as { user?: { name?: string } }).user
        if (user?.name) names.push(user.name)
      })
      setRemoteUsers(names)
    }
    const statusHandler = (next: typeof status): void => setStatus(next)
    provider.on(`status`, statusHandler)
    awareness.on(`change`, updateRemoteUsers)
    provider.connect()
    setStatus(`connecting`)

    return () => {
      provider.off(`status`, statusHandler)
      awareness.off(`change`, updateRemoteUsers)
      provider.destroy()
      editorViewRef.current?.destroy()
      editorViewRef.current = null
      ydoc.destroy()
      setRemoteUsers([])
    }
  }, [baseUrl, documentEntry, principalLabel])

  if (!documentId) {
    return <div className={styles.empty}>No document selected.</div>
  }

  return (
    <div className={styles.root}>
      <div className={styles.bar}>
        <div className={styles.title}>
          {documentEntry?.title ?? `Markdown document`}
        </div>
        <div className={styles.presence}>
          <span className={styles.status}>{status}</span>
          {remoteUsers.slice(0, 3).map((name) => {
            const color = colorFor(name)
            return (
              <span key={name} className={styles.presence}>
                <span
                  className={styles.presenceDot}
                  style={{ backgroundColor: color.color }}
                />
                <span className={styles.status}>{name}</span>
              </span>
            )
          })}
        </div>
      </div>
      {status === `error` ? (
        <div className={styles.empty}>Document could not be opened.</div>
      ) : (
        <div ref={editorRef} className={styles.editor} />
      )}
    </div>
  )
}
