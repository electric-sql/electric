# Native app comments — design

## Goal

Bring the desktop comments feature (shipped in #4551, "generic externally-writable
custom collections, comments as first consumer") to the native app
(`packages/agents-mobile`) at full desktop parity:

1. **Read** comment bubbles inline in the session timeline.
2. **Post** top-level comments from the composer.
3. **Reply** to a specific timeline row or comment (with a target snapshot).
4. A dedicated **comments-only view**.

The runtime and server are already generic and done; this is a client-only change
in `agents-mobile` plus small additive threading in the shared `agents-server-ui`
embed/components. No backend changes.

## Background: how the mobile session screen is built

Unlike desktop, the mobile session screen is a **split**:

- The **timeline** is rendered by a shared web component running inside an Expo-DOM
  WebView: `app/session.tsx` mounts `SessionChatLogDomEmbed`
  (`agents-server-ui/src/embed/SessionChatLogDomEmbed`) →
  `EmbedChatLogRoot` → `EntityHost` (view `chat-log`) → `ChatLogView`
  (`agents-server-ui/src/components/views/ChatView.tsx`) → `EntityTimeline`.
- The **composer** is native: `SessionScreen.tsx`'s `NativeMessageComposer`.

The Expo-DOM bridge is simple and one-directional per channel:

- **Native → WebView**: props (`serverUrl`, `entityUrl`, `scrollToBottomSignal`,
  `inlineQueuedMessages`, `bottomInset`, `serverHeaders`, …).
- **WebView → native**: marshalled async callback props. Today only
  `onRequestOpenEntity(entityUrl)` exists.

Because `ChatLogView` already calls `useEntityTimeline(baseUrl, connectUrl)` with no
opts, and `useEntityTimeline` defaults `comments` on when `commentsEnabled`, **comment
bubbles already render in the mobile chat log today**. What is missing on mobile is the
_write_ path, the _reply_ affordance, and the _comments-only_ view.

## Reused, unchanged

- Runtime/server: generic externally-writable collections, `commentsCollection`,
  `/collections/comments` endpoint, `_principal` virtual column. No changes.
- `agents-server-ui/src/lib/comments.ts`: `createSendCommentAction`,
  `createCommentsTimelineSource`, `buildCommentsTimeline`, target encode/decode,
  `EntityTimelineCommentRow`, `SelectedCommentTarget`. Imported by mobile as-is.
- `agents-server-ui/src/lib/comments-capability.ts`: `supportsComments` /
  contract gating. Surfaced to mobile via `useEntityTimeline().commentsEnabled`.
- `agents-server-ui/src/lib/principals.ts`, `useCurrentPrincipal` (mobile already
  has it) for the `from` author.
- `EntityTimeline` + `CommentBubble` rendering and their CSS — bubbles inherit the
  shared embed styles, no native restyle.

## Changes

### 1. Capability gating (mobile)

`SessionScreen` already destructures from `useEntityTimeline`. Also read
`commentsEnabled`. Gate all comment UI on `commentsEnabled && canWrite`
(`canWrite` already computed from `useEntityPermissions` against `SESSION_PERMISSIONS`,
which includes `write`). No new collection registration — `entity-connection`
registers `db.collections.comments` from entity metadata for both the embed and the
native hook.

### 2. Reply affordance: WebView → native bridge

Add one new optional callback prop, threaded through the shared embed:

```
SessionChatLogDomEmbed  (new prop: onRequestReplyToComment?)
  → EmbedChatLogRoot / EmbedSurfaceProps
    → EntityHost / ChatLogView  (new optional prop: onReplyToRow passthrough)
      → EntityTimeline.onReplyToRow / onCommentTargetClick
```

- The callback signature carries the reply target and snapshot:
  `onRequestReplyToComment(target: CommentTarget, snapshot: CommentSnapshot)`.
  Both are plain JSON and marshal across the Expo-DOM boundary cleanly.
- `ChatLogView` gains an **optional** `onReplyToRow` (and `onCommentTargetClick`)
  prop. When absent (desktop tile usage) behaviour is unchanged; when present (mobile
  embed) it enables the reply button on comment/timeline rows and forwards the target.
- Desktop callers of `ChatLogView` are unaffected (new props are optional and unset).

### 3. Native composer comment mode

Extend `NativeMessageComposer` (in `SessionScreen.tsx`) with a
`'prompt' | 'comment'` mode, mirroring desktop `MessageInput`:

- Mode toggle rendered only when `commentsEnabled && canWrite` and not editing a
  queued message. Hidden otherwise (status quo for non-comment entities).
- In comment mode: placeholder "Add a comment…", send posts a comment instead of a
  composer input; image attachments / slash autocomplete are disabled (comments are
  plain text, matching desktop).
- Wire `createSendCommentAction({ db, baseUrl: serverUrl, entityUrl, from })` where
  `from` comes from `useCurrentPrincipal`. The optimistic insert + `POST
/collections/comments` is reused verbatim; on send, bump the existing
  `onSendMessage` scroll signal.
- **Reply target state**: a `selectedCommentTarget: SelectedCommentTarget | null`
  lives in the native session screen. When `onRequestReplyToComment` fires from the
  bridge: set the target, switch the composer to comment mode, focus the input, and
  render a native **reply banner** (snapshot label + truncated text + clear button),
  mirroring desktop. Clearing the target drops back to a top-level comment. The target
  - snapshot are passed into `createSendCommentAction`'s call as `replyTo` /
    `targetSnapshot`.

### 4. Comments-only view (parity)

- Add `'comments'` to `EmbedViewId` (`src/lib/embedView.ts`).
- **Embed side**: add a `commentsOnly?: boolean` prop on the chat-log embed
  (`SessionChatLogDomEmbed` → `EmbedChatLogRoot` → `ChatLogView`). When set,
  `ChatLogView` renders `buildCommentsTimeline(timelineRows)` (filtered rows +
  adjacency) instead of the full timeline. This reuses the existing component/embed
  path rather than introducing a separate embed module.
- **Native side**: in `app/session.tsx`, when `view === 'comments'`, pass
  `commentsOnly` to the embed and render the native composer in **comment-only** mode
  (always comment, no prompt toggle), mirroring desktop `CommentsView`.
- **Entry point**: `SessionMenu`'s view switcher (currently chat / state-explorer)
  gains a "Comments" entry, shown only when the entity `commentsEnabled`.

### 5. Tests

Following the repo's tight-test style:

- Native comment-send path: composing in comment mode invokes
  `createSendCommentAction` with the expected `{ body, replyTo?, targetSnapshot? }`,
  and clears/keeps the reply target correctly.
- Bridge serialization: a reply target round-trips through the
  `onRequestReplyToComment` callback shape (target + snapshot are JSON-safe).
- Capability gating: comment toggle / comments view hidden when `commentsEnabled` is
  false or `canWrite` is false.

## Out of scope

- No backend / runtime / server changes.
- No rich-text in comments (desktop comments are plain text too).
- No new comment data shape — reuse `commentsCollection` / `comments/v1` contract.

## Files touched (anticipated)

- `packages/agents-mobile/src/screens/SessionScreen.tsx` — composer comment mode,
  reply banner, reply-target state, `commentsEnabled` gating.
- `packages/agents-mobile/app/session.tsx` — `'comments'` view wiring,
  `onRequestReplyToComment` callback, `commentsOnly` prop pass-through.
- `packages/agents-mobile/src/lib/embedView.ts` — add `'comments'`.
- `packages/agents-mobile/src/components/SessionMenu.tsx` — comments view entry.
- `packages/agents-server-ui/src/embed/SessionChatLogDomEmbed.tsx` &
  `embed/EmbedApp.tsx` — new optional `onRequestReplyToComment` / `commentsOnly`
  props threaded through.
- `packages/agents-server-ui/src/components/views/ChatView.tsx` — optional
  `onReplyToRow` / `onCommentTargetClick` / `commentsOnly` on `ChatLogView`.
- Tests alongside the above.
