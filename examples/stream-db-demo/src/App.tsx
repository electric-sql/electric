import { z } from 'zod'
import { createStateSchema, createStreamDB } from '@durable-streams/state'
import { useLiveQuery } from '@tanstack/react-db'

const STREAM_URL = import.meta.env.VITE_STREAM_URL
const STREAM_SECRET = import.meta.env.VITE_STREAM_SECRET

// --- Demo data ---

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]!
const roles = [`user`, `assistant`, `system`] as const
const phrases = [
  `What's the weather?`,
  `Temperature is 72\u00b0F.`,
  `Deploy to staging.`,
  `Build succeeded.`,
  `Running health check\u2026`,
  `Can you help me?`,
]
const users = [`alice`, `bob`, `charlie`, `diana`, `eve`, `frank`]
const agentNames = [`Atlas`, `Nova`, `Helix`, `Pulse`, `Cipher`, `Spark`]

// --- Schema: three entity types, one stream ---

const schema = createStateSchema({
  messages: {
    schema: z.object({
      id: z.string(),
      role: z.enum([`user`, `assistant`, `system`]),
      content: z.string(),
      createdAt: z.string(),
    }),
    type: `message`,
    primaryKey: `id`,
  },
  presence: {
    schema: z.object({
      userId: z.string(),
      status: z.enum([`online`, `offline`]),
    }),
    type: `presence`,
    primaryKey: `userId`,
  },
  agents: {
    schema: z.object({
      agentId: z.string(),
      name: z.string(),
      endpoint: z.string(),
    }),
    type: `agent`,
    primaryKey: `agentId`,
  },
})

// --- StreamDB: reactive, durable, multiplexed ---

const db = createStreamDB({
  streamOptions: {
    url: STREAM_URL,
    headers: {
      Authorization: `Bearer ${STREAM_SECRET}`,
    },
    contentType: `application/json`,
  },
  state: schema,
  actions: ({ db, stream }) => ({
    addMessage: {
      onMutate: (msg) => db.collections.messages.insert(msg),
      mutationFn: async (msg) => {
        const txid = crypto.randomUUID()
        const event = schema.messages.insert({ value: msg, headers: { txid } })
        await stream.append(JSON.stringify(event))
        await db.utils.awaitTxId(txid)
      },
    },
    setPresence: {
      onMutate: (p) => db.collections.presence.insert(p),
      mutationFn: async (p) => {
        const txid = crypto.randomUUID()
        const event = schema.presence.insert({ value: p, headers: { txid } })
        await stream.append(JSON.stringify(event))
        await db.utils.awaitTxId(txid)
      },
    },
    addAgent: {
      onMutate: (a) => db.collections.agents.insert(a),
      mutationFn: async (a) => {
        const txid = crypto.randomUUID()
        const event = schema.agents.insert({ value: a, headers: { txid } })
        await stream.append(JSON.stringify(event))
        await db.utils.awaitTxId(txid)
      },
    },
  }),
})
db.preload()

// --- Components ---

function Messages() {
  const { data } = useLiveQuery((q) =>
    q
      .from({ m: db.collections.messages })
      .orderBy(({ m }) => m.createdAt, `asc`)
  )

  return (
    <div className="col messages">
      <h2>
        Messages <span className="n">{data.length}</span>
      </h2>
      <div className="items">
        {data.map((m) => (
          <div key={m.id} className="item">
            <span className={`badge ${m.role}`}>{m.role}</span>
            {m.content}
          </div>
        ))}
      </div>
      <button
        onClick={() => {
          db.actions.addMessage({
            id: crypto.randomUUID(),
            role: pick(roles),
            content: pick(phrases),
            createdAt: new Date().toISOString(),
          })
        }}
      >
        + Message
      </button>
    </div>
  )
}

function Presence() {
  const { data } = useLiveQuery((q) => q.from({ p: db.collections.presence }))

  return (
    <div className="col presence">
      <h2>
        Presence <span className="n">{data.length}</span>
      </h2>
      <div className="items">
        {data.map((p) => (
          <div key={p.userId} className="item row">
            <span className={`dot ${p.status}`} />
            <span>{p.userId}</span>
            <span className="status-label">{p.status}</span>
          </div>
        ))}
      </div>
      <button
        onClick={() => {
          db.actions.setPresence({
            userId: pick(users),
            status: pick([`online`, `offline`] as const),
          })
        }}
      >
        + Presence
      </button>
    </div>
  )
}

function Agents() {
  const { data } = useLiveQuery((q) => q.from({ a: db.collections.agents }))

  return (
    <div className="col agents">
      <h2>
        Agents <span className="n">{data.length}</span>
      </h2>
      <div className="items">
        {data.map((a) => (
          <div key={a.agentId} className="item">
            <strong>{a.name}</strong>
            <code>{a.endpoint}</code>
          </div>
        ))}
      </div>
      <button
        onClick={() => {
          db.actions.addAgent({
            agentId: crypto.randomUUID(),
            name: pick(agentNames),
            endpoint: `/agents/${name.toLowerCase()}`,
          })
        }}
      >
        + Agent
      </button>
    </div>
  )
}

export default function App() {
  return (
    <div className="app">
      <header>
        <h1>StreamDB</h1>
        <p>Three types &middot; One stream &middot; Live</p>
      </header>
      <main className="cols">
        <Messages />
        <Presence />
        <Agents />
      </main>
    </div>
  )
}
