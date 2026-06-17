'use dom'

import '../ui/tokens.css'
import '../ui/global.css'
import './SessionDomEmbed.css'
import { useCallback, useState } from 'react'
import { useDOMImperativeHandle } from 'expo/dom'
import { installMobileCryptoPolyfill } from './mobileDomRuntime'
import { EmbedChatLogRoot, type EmbedSurfaceProps } from './EmbedApp'
import type { SessionChatLogDomRef } from './sessionChatLogDomRef'
import type { OptimisticInboxMessage } from '../lib/sendMessage'

installMobileCryptoPolyfill()

if (typeof document !== `undefined`) {
  document.documentElement.setAttribute(`data-electric-mobile-dom`, `true`)
}

export type SessionChatLogDomEmbedProps = EmbedSurfaceProps & {
  onRequestOpenEntity: (entityUrl: string) => Promise<void>
  ref?: React.Ref<SessionChatLogDomRef>
  dom?: unknown
}

export default function SessionChatLogDomEmbed({
  onRequestOpenEntity,
  ref,
  inlineQueuedMessages: initialInlineQueuedMessages,
  ...props
}: SessionChatLogDomEmbedProps): React.ReactElement {
  // Seeded once from props, then driven via the imperative handle below: this
  // re-renders the inner tree (like a streamed message) instead of updating a
  // prop, which would re-post across the bridge and flash. See SessionChatLogDomRef.
  const [inlineQueued, setInlineQueued] = useState<
    Array<OptimisticInboxMessage>
  >(() => initialInlineQueuedMessages ?? [])

  useDOMImperativeHandle<SessionChatLogDomRef>(
    ref ?? null,
    () => ({
      setBottomInset(px: unknown) {
        if (typeof document === `undefined`) return
        const value = typeof px === `number` ? px : Number(px) || 0
        document.documentElement.style.setProperty(
          `--mobile-chat-bottom-inset`,
          `${Math.max(0, value)}px`
        )
      },
      scrollToBottom() {
        if (typeof document === `undefined`) return
        requestAnimationFrame(() => {
          const viewport = document.querySelector(
            `.mobile-chat-scroll-viewport`
          )
          if (viewport instanceof HTMLElement) {
            viewport.scrollTop = viewport.scrollHeight
          }
        })
      },
      setInlineQueuedMessages(messages: unknown) {
        setInlineQueued(
          Array.isArray(messages)
            ? (messages as Array<OptimisticInboxMessage>)
            : []
        )
      },
    }),
    []
  )
  // useCallback so an inner-tree re-render keeps this identity: the embed's
  // router is memoized on it, and a new identity would remount the timeline.
  const handleNavigatePathname = useCallback(
    (pathname: string) => {
      const match = /^\/entity(\/.+)$/.exec(pathname)
      const target = match?.[1]
      if (target) return onRequestOpenEntity(target)
    },
    [onRequestOpenEntity]
  )
  return (
    <EmbedChatLogRoot
      {...props}
      inlineQueuedMessages={inlineQueued}
      onNavigatePathname={handleNavigatePathname}
    />
  )
}
