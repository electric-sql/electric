import { useEffect, useMemo, useRef, useState } from 'react'
import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView, basicSetup } from 'codemirror'
import { keymap } from '@codemirror/view'
import { YjsProvider } from '@durable-streams/y-durable-streams'
import { useLiveQuery } from '@tanstack/react-db'
import { Plug, TriangleAlert, Unplug } from 'lucide-react'
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import * as decoding from 'lib0/decoding'
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness'
import * as Y from 'yjs'
import { useCurrentPrincipal } from '../../hooks/useCurrentPrincipal'
import { getConfiguredServerHeaders, serverFetch } from '../../lib/auth-fetch'
import { useElectricAgents } from '../../lib/ElectricAgentsProvider'
import {
  principalKeyFromInput,
  userDisplayName,
  userIdFromPrincipal,
} from '../../lib/principals'
import { Icon, ScrollArea } from '../../ui'
import styles from './MarkdownDocumentView.module.css'
import type { EntityViewProps } from '../../lib/workspace/viewRegistry'
import {
  MARKDOWN_DOCUMENT_AGENT_PRESENCE_TTL_MS,
  type ManifestDocumentEntry,
} from '@electric-ax/agents-runtime/client'
import type { LucideIcon } from 'lucide-react'

type DocumentResponse = {
  document: ManifestDocumentEntry
}

type DocumentConnectionStatus =
  | `loading`
  | `connecting`
  | `connected`
  | `disconnected`
  | `error`

type RemoteUser = {
  name: string
  status?: string
  color?: string
  expiresAt?: number
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

function connectionStatusLabel(status: DocumentConnectionStatus): string {
  switch (status) {
    case `loading`:
      return `Loading document`
    case `connecting`:
      return `Connecting`
    case `connected`:
      return `Connected`
    case `disconnected`:
      return `Disconnected`
    case `error`:
      return `Connection error`
  }
}

function connectionStatusIcon(status: DocumentConnectionStatus): LucideIcon {
  switch (status) {
    case `error`:
      return TriangleAlert
    case `disconnected`:
      return Unplug
    case `loading`:
    case `connecting`:
    case `connected`:
      return Plug
  }
}

function principalPresenceLabel(principalKey: string): string {
  const colon = principalKey.indexOf(`:`)
  const id = colon >= 0 ? principalKey.slice(colon + 1) : principalKey
  if (id.startsWith(`/`)) {
    return id.split(`/`).filter(Boolean).at(-1) ?? id
  }
  return id || principalKey
}

export function applyMarkdownAwarenessFrames(
  awareness: Awareness,
  data: Uint8Array
): void {
  if (data.length === 0) return
  const decoder = decoding.createDecoder(data)
  while (decoding.hasContent(decoder)) {
    applyAwarenessUpdate(
      awareness,
      decoding.readVarUint8Array(decoder),
      `server`
    )
  }
}

async function primeMarkdownAwareness(
  awareness: Awareness,
  docUrl: URL,
  signal: AbortSignal
): Promise<void> {
  const awarenessUrl = new URL(docUrl)
  awarenessUrl.searchParams.set(`awareness`, `default`)
  awarenessUrl.searchParams.set(`offset`, `-1`)
  const response = await serverFetch(awarenessUrl, {
    method: `GET`,
    headers: getConfiguredServerHeaders(awarenessUrl),
    signal,
  })
  if (signal.aborted) return
  if (response.status === 404) return
  if (!response.ok) return
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (signal.aborted) return

  const snapshot = new Awareness(new Y.Doc())
  applyMarkdownAwarenessFrames(snapshot, bytes)
  const now = Date.now()
  const activeAgents = Array.from(snapshot.getStates())
    .filter(([, state]) => {
      const user = (
        state as {
          user?: { role?: string; status?: string; expiresAt?: number }
        }
      ).user
      return (
        user?.role === `agent` &&
        user.status === `editing` &&
        typeof user.expiresAt === `number` &&
        user.expiresAt > now
      )
    })
    .map(([clientId]) => clientId)
  if (activeAgents.length > 0) {
    applyAwarenessUpdate(
      awareness,
      encodeAwarenessUpdate(snapshot, activeAgents),
      `server`
    )
  }
  snapshot.destroy()
}

export function markdownDocumentConnectionConfig(
  baseUrl: string,
  documentEntry: ManifestDocumentEntry
): {
  providerUrl: string
  docUrl: URL
  docId: string
  yTextName: string
} {
  const providerUrl = providerBaseUrl(baseUrl, documentEntry.streamPath)
  const docId = documentEntry.docId
  return {
    providerUrl,
    docId,
    yTextName: documentEntry.yTextName,
    docUrl: new URL(`${providerUrl}/docs/${docId}`),
  }
}

export function MarkdownDocumentView({
  baseUrl,
  entityUrl,
  viewParams,
}: EntityViewProps): React.ReactElement {
  const documentId = viewParams?.doc ?? null
  const editorRef = useRef<HTMLDivElement | null>(null)
  const editorViewRef = useRef<EditorView | null>(null)
  const remoteStateFirstSeenRef = useRef<Map<number, number>>(new Map())
  const [documentEntry, setDocumentEntry] =
    useState<ManifestDocumentEntry | null>(null)
  const [status, setStatus] = useState<DocumentConnectionStatus>(`loading`)
  const [remoteUsers, setRemoteUsers] = useState<Array<RemoteUser>>([])
  const { principal } = useCurrentPrincipal()
  const { usersCollection } = useElectricAgents()
  const { data: users = [] } = useLiveQuery(
    (q) => {
      if (!usersCollection) return undefined
      return q.from({ user: usersCollection })
    },
    [usersCollection]
  )
  const usersById = useMemo(
    () => new Map(users.map((user) => [user.id, user] as const)),
    [users]
  )

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

  const principalLabel = useMemo(() => {
    const userId = userIdFromPrincipal(principal)
    const user = userId ? usersById.get(userId) : undefined
    const displayName = userDisplayName(user)
    if (displayName) return displayName
    return principalPresenceLabel(principalKeyFromInput(principal) ?? principal)
  }, [principal, usersById])

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

    const { providerUrl, docUrl, docId, yTextName } =
      markdownDocumentConnectionConfig(baseUrl, documentEntry)
    const awarenessPrimeController = new AbortController()
    void primeMarkdownAwareness(
      awareness,
      docUrl,
      awarenessPrimeController.signal
    ).catch(() => undefined)
    const provider = new YjsProvider({
      doc: ydoc,
      baseUrl: providerUrl,
      docId,
      awareness,
      headers: getConfiguredServerHeaders(docUrl),
      liveMode: `sse`,
    })
    const ytext = ydoc.getText(yTextName)
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
      const users: Array<RemoteUser> = []
      const staleClients: Array<number> = []
      const seenClients = new Set<number>()
      const now = Date.now()
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === awareness.clientID) return
        seenClients.add(clientId)
        const user = (
          state as {
            user?: {
              name?: string
              status?: string
              color?: string
              role?: string
              expiresAt?: number
            }
          }
        ).user
        const firstSeen =
          remoteStateFirstSeenRef.current.get(clientId) ?? Date.now()
        remoteStateFirstSeenRef.current.set(clientId, firstSeen)
        const isExpired =
          typeof user?.expiresAt === `number`
            ? user.expiresAt <= now
            : user?.role === `agent` &&
              user.status === `editing` &&
              now - firstSeen > MARKDOWN_DOCUMENT_AGENT_PRESENCE_TTL_MS
        if (isExpired) {
          staleClients.push(clientId)
          return
        }
        if (user?.name) {
          users.push({
            name: user.name,
            status: user.status,
            color: user.color,
            expiresAt: user.expiresAt,
          })
        }
      })
      for (const clientId of remoteStateFirstSeenRef.current.keys()) {
        if (!seenClients.has(clientId)) {
          remoteStateFirstSeenRef.current.delete(clientId)
        }
      }
      if (staleClients.length > 0) {
        removeAwarenessStates(awareness, staleClients, `stale-agent-presence`)
      }
      setRemoteUsers(users)
    }
    const statusHandler = (next: DocumentConnectionStatus): void =>
      setStatus(next)
    provider.on(`status`, statusHandler)
    awareness.on(`change`, updateRemoteUsers)
    const stalePresenceInterval = window.setInterval(updateRemoteUsers, 1_000)
    provider.connect()
    setStatus(`connecting`)

    return () => {
      awarenessPrimeController.abort()
      window.clearInterval(stalePresenceInterval)
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
          <span
            className={styles.connectionStatus}
            data-status={status}
            aria-label={connectionStatusLabel(status)}
            title={connectionStatusLabel(status)}
          >
            <Icon icon={connectionStatusIcon(status)} size={1} />
          </span>
          {remoteUsers.slice(0, 3).map((user) => {
            const color = user.color ?? colorFor(user.name).color
            return (
              <span key={user.name} className={styles.presence}>
                <span
                  className={styles.presenceDot}
                  style={{ backgroundColor: color }}
                />
                <span className={styles.status}>
                  {user.status ? `${user.name} · ${user.status}` : user.name}
                </span>
              </span>
            )
          })}
        </div>
      </div>
      {status === `error` ? (
        <div className={styles.empty}>Document could not be opened.</div>
      ) : (
        <ScrollArea
          className={styles.editorScrollArea}
          viewportClassName={styles.editorViewport}
          scrollbars="vertical"
        >
          <div ref={editorRef} className={styles.editor} />
        </ScrollArea>
      )}
    </div>
  )
}
