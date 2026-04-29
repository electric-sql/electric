import { useState, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { createAgentsClient, entity } from '@electric-ax/agents-runtime'
import { useChat } from '@electric-ax/agents-runtime/react'
import {
  Theme,
  Box,
  Flex,
  Heading,
  Text,
  TextField,
  Button,
  Card,
} from '@radix-ui/themes'
import { Streamdown } from 'streamdown'
import '@radix-ui/themes/styles.css'
import 'streamdown/styles.css'
import type { EntityStreamDB } from '@electric-ax/agents-runtime'

const AGENTS_URL = `http://localhost:4437`

const AGENT_COLORS: Record<string, { bg: string; border: string }> = {
  analyser: { bg: `var(--blue-3)`, border: `var(--blue-6)` },
  optimist: { bg: `var(--green-3)`, border: `var(--green-6)` },
  critic: { bg: `var(--red-3)`, border: `var(--red-6)` },
}

function useEntityDb(url: string | null, retryMs = 0) {
  const [db, setDb] = useState<EntityStreamDB | null>(null)

  useEffect(() => {
    if (!url) {
      setDb(null)
      return
    }
    let cancelled = false
    let observedDb: EntityStreamDB | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      const client = createAgentsClient({ baseUrl: AGENTS_URL })
      client.observe(entity(url)).then(
        (observed) => {
          observedDb = observed as EntityStreamDB
          if (cancelled) {
            observedDb.close()
            return
          }
          setDb(observedDb)
        },
        () => {
          if (!cancelled && retryMs > 0) {
            timer = setTimeout(connect, retryMs)
          }
        }
      )
    }
    connect()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      observedDb?.close()
    }
  }, [url, retryMs])

  return db
}

interface AgentMessage {
  agent: string
  text: string
  isStreaming: boolean
}

function useAgentMessages(
  url: string | null,
  agent: string,
  retryMs = 0
): AgentMessage[] {
  const db = useEntityDb(url, retryMs)
  const chat = useChat(db)

  return chat.runs.flatMap((r, ri) =>
    r.texts
      .filter((t) => t.text.trim().length > 0)
      .map((t, ti) => ({
        agent,
        text: t.text,
        isStreaming:
          chat.state === `working` &&
          ri === chat.runs.length - 1 &&
          ti === r.texts.length - 1,
      }))
  )
}

function MessageBubble({ msg }: { msg: AgentMessage }) {
  const colors = AGENT_COLORS[msg.agent] ?? {
    bg: `var(--gray-3)`,
    border: `var(--gray-6)`,
  }

  return (
    <Card
      size="1"
      style={{
        background: colors.bg,
        borderLeft: `3px solid ${colors.border}`,
      }}
    >
      <Text size="1" weight="bold" style={{ textTransform: `capitalize` }}>
        {msg.agent}
      </Text>
      <Box mt="1" style={{ fontSize: `var(--font-size-2)` }}>
        <Streamdown isAnimating={msg.isStreaming} controls={false}>
          {msg.text}
        </Streamdown>
      </Box>
    </Card>
  )
}

function App() {
  const [question, setQuestion] = useState(``)
  const [urls, setUrls] = useState<{
    entityUrl: string
    optimistUrl: string
    criticUrl: string
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const analyserMessages = useAgentMessages(urls?.entityUrl ?? null, `analyser`)
  const optimistMessages = useAgentMessages(
    urls?.optimistUrl ?? null,
    `optimist`,
    2000
  )
  const criticMessages = useAgentMessages(
    urls?.criticUrl ?? null,
    `critic`,
    2000
  )

  const hasWorkerMessages =
    optimistMessages.length > 0 || criticMessages.length > 0
  // First analyser message is the intro; the rest is synthesis after workers
  const analyserIntro = analyserMessages.slice(0, 1)
  const analyserSynthesis = hasWorkerMessages ? analyserMessages.slice(1) : []

  useEffect(() => {
    const el = bottomRef.current?.parentElement
    if (!el) return
    const observer = new MutationObserver(() => {
      window.scrollTo({ top: document.body.scrollHeight, behavior: `smooth` })
    })
    observer.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    })
    return () => observer.disconnect()
  }, [urls])

  const handleAnalyze = async () => {
    if (!question.trim()) return
    setLoading(true)
    try {
      const res = await fetch(`/api/analyze`, {
        method: `POST`,
        headers: { 'Content-Type': `application/json` },
        body: JSON.stringify({ question }),
      })
      const data = (await res.json()) as {
        entityUrl: string
        optimistUrl: string
        criticUrl: string
      }
      setUrls(data)
    } catch (err) {
      console.error(`Analyze failed:`, err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Theme appearance="light" accentColor="blue" radius="medium">
      <style>{`@keyframes blink { 50% { opacity: 0; } }`}</style>
      <Box maxWidth="900px" mx="auto" p="5">
        <Heading size="6" mb="1">
          Perspectives Analyzer
        </Heading>
        <Text size="2" color="gray" mb="5" as="p">
          Ask a question and get two perspectives — an optimist and a critic —
          then a balanced analysis.
        </Text>

        <Flex gap="2" mb="5">
          <Box flexGrow="1">
            <TextField.Root
              size="3"
              placeholder="Enter a question to analyze..."
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === `Enter` && handleAnalyze()}
            />
          </Box>
          <Button
            size="3"
            onClick={handleAnalyze}
            disabled={loading || !question.trim()}
          >
            {loading ? `Analyzing...` : `Analyze`}
          </Button>
        </Flex>

        <Flex direction="column" gap="3">
          {urls && analyserIntro.length === 0 && (
            <Text color="gray" size="2">
              Waiting for agents to respond...
            </Text>
          )}

          {/* Analyser intro — full width */}
          {analyserIntro.map((msg, i) => (
            <MessageBubble
              key={`analyser-intro-${i}`}
              msg={hasWorkerMessages ? { ...msg, isStreaming: false } : msg}
            />
          ))}

          {/* Workers side-by-side */}
          {hasWorkerMessages && (
            <Flex gap="3">
              <Flex direction="column" gap="3" style={{ flex: 1, minWidth: 0 }}>
                {optimistMessages.map((msg, i) => (
                  <MessageBubble key={`optimist-${i}`} msg={msg} />
                ))}
              </Flex>
              <Flex direction="column" gap="3" style={{ flex: 1, minWidth: 0 }}>
                {criticMessages.map((msg, i) => (
                  <MessageBubble key={`critic-${i}`} msg={msg} />
                ))}
              </Flex>
            </Flex>
          )}

          {/* Analyser synthesis — full width */}
          {analyserSynthesis.map((msg, i) => (
            <MessageBubble key={`analyser-synth-${i}`} msg={msg} />
          ))}

          <div ref={bottomRef} />
        </Flex>
      </Box>
    </Theme>
  )
}

createRoot(document.getElementById(`root`)!).render(<App />)
