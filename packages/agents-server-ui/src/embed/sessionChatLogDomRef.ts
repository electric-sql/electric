/**
 * Imperative handle the native side uses to drive the chat-log DOM embed. Values
 * are pushed through methods, not props: any prop crossing the Expo DOM bridge
 * re-renders the embed and flashes the WebView. Args arrive JSON-serialized.
 *
 * Lives in a plain module (not the `'use dom'` embed, whose named exports the
 * consuming app can't resolve). The index signature inlines expo's
 * `DOMImperativeFactory` contract so this resolves without importing `expo/dom`,
 * which agents-server-ui can't resolve.
 */
export interface SessionChatLogDomRef {
  [method: string]: (...args: Array<unknown>) => void
  setBottomInset(px: unknown): void
  scrollToBottom(): void
  setInlineQueuedMessages(messages: unknown): void
}
