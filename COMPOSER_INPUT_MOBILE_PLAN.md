# Mobile Composer Input Plan (Horton prompt on agents-mobile)

## Status

Partially implemented on this branch. This extends
[COMPOSER_INPUT_PLAN.md](./COMPOSER_INPUT_PLAN.md) (the desktop/runtime composer
work) to the React Native (Expo) mobile app. All file/line references below were
verified against the current tree.

- **PR1 — shared grammar extraction:** done. Serializer + grammar live in
  `agents-runtime/src/composer-input.ts`, exported via `/client`, with a shared
  `detectSlashCommandTrigger` helper; desktop call sites repointed; tests moved
  to the runtime suite.
- **PR2 — native in-session slash composer:** done. `NativeComposer.tsx` +
  `lib/slashAutocomplete.ts` (pure, tested) drive a native keyboard-docked
  autocomplete on the existing `SessionScreen` `TextInput`, sending
  `composer_input`. Scope deviations are noted below (in-session only; no static
  fallback; edit matches desktop's flatten).
- **PR3 — inline live-markdown pills:** deferred. Depends on a physical-device
  spike (worklets / `react-native-live-markdown` on Expo 54 / RN 0.81 / React 19)
  that can't be run in a headless environment; the parity win ships without it.

## Summary

Give the mobile app's Horton prompt feature/experience parity with the desktop
ProseMirror composer — starting with slash commands and structured
`composer_input` payloads — by building a **native** composer (a real RN
`TextInput`, its own component, distinct from the timeline) rather than embedding
the desktop ProseMirror editor in a WebView/DOM component.

The only reuse that matters is **pure, platform-agnostic logic**: the
`composer_input` runtime contract and the slash-command grammar/serializer. Those
are shared losslessly. The editor surface itself (ProseMirror schema,
decorations, caret-anchored popover) is DOM-only and is re-implemented natively —
which also makes the slash-command autocomplete popover trivially native, because
the query, command list, and selection index are all plain React state in one RN
tree.

## Goals

- A `composer_input`-producing prompt on mobile: raw source text + an ordered
  list of parsed slash-command nodes, identical wire shape to desktop.
- Slash-command autocomplete with a **native** (not DOM) popover, docked above
  the keyboard.
- The composer is its own component, well-tied to the keyboard, separate from the
  conversation timeline (which stays the existing DOM/web embed).
- Maximal sane reuse of the runtime contract and the slash-command grammar so
  desktop and mobile cannot silently diverge.
- Native feel: system keyboard, IME/CJK, autocorrect, dictation, selection
  handles, accessibility — all for free.
- Extensible to the other already-enumerated node kinds (`file`, `symbol`,
  `branch`) without a second mobile fork.

## Non-Goals

- Embedding the desktop ProseMirror `ComposerEditor` in a WebView / Expo DOM
  component for the typing surface (see Decision).
- Changing the `composer_input` wire contract or any server/runtime behavior.
- Caret-anchored inline popovers (RN `TextInput` exposes selection indices but
  **not** caret x/y; there is no analog to ProseMirror's `view.coordsAtPos`).
- True deletable "atom" pills in v1 (live-markdown styles ranges, not atoms).
- Re-implementing the ProseMirror schema, decorations, or keymap on mobile.

## Decision: Native composer, not a WebView

We reject hosting the desktop ProseMirror editor inside an Expo `'use dom'`
component / `react-native-webview` for the **typing surface**. Rationale:

- The reuse it buys (editor code) is not the reuse we need. The valuable shared
  pieces (wire contract + grammar) are pure logic we share without a WebView.
- A WebView typing surface imports WKWebView caret/keyboard friction: caret
  hiding, double `KeyboardAvoidingView` interplay, unreliable Android focus, and
  IME/autocorrect quirks.
- The native popover would then need per-keystroke `postMessage` of the active
  query (and there is still no usable caret rect across the bridge), trading a
  simple native-state read for a fragile cross-realm bridge.
- `prosemirror-view` needs a real DOM, so it cannot run under `react-native-web`
  — a WebView would be _mandatory_ for the ProseMirror path, not optional.

The conversation **timeline** stays the existing `'use dom'` web embed. We split
_typing_ (native) from _reading_ (DOM); we do not touch the transcript.

## Architecture

1. **Input component (native).** New
   `packages/agents-mobile/src/components/NativeComposer.tsx` wrapping a multiline
   `TextInput`. `value` / `onChangeText` / auto-grow and the send-button model
   stay as today. Inline `/command` pill styling is deferred to PR3 (gated on a
   spike); v1 ships a plain `TextInput`.

2. **Payload.** On submit:
   `serializeComposerInput(text, slashCommands) → ComposerInputPayload`
   (`{ source, nodes }`), sent via `createSendComposerInputAction`
   (`sendMessage.ts:460`) instead of `createSendMessageAction`
   (`sendMessage.ts:351`). The optimistic inbox insert lands in the same entity
   stream DB collection the DOM timeline embed reads, so the web timeline renders
   it. No server / runtime / wire work.

3. **Slash-command discovery (works today — see Correction #1).** `useLiveQuery`
   over `db.collections.slashCommands` — a **built-in** entity-stream-DB
   collection that mobile's `SessionScreen` already holds (`SessionScreen.tsx:174`,
   the `db` it already passes to the native action creators). Filter by
   `normalizeCommandName` prefix; fall back to a static `fallbackSlashCommands`
   list (as `ChatView.tsx:254` computes for desktop) for statically-declared
   commands. Mirrors `MessageInput.tsx:111-123` exactly.

4. **Native popover.** From `text.slice(0, selection.start)`, regex a trailing
   `/`-token at a word boundary → `{ triggerActive, from, to, query }`, all plain
   React state. Render a `FlatList`/`ScrollView` of commands docked directly above
   the input bar (the Slack/Discord/iMessage pattern). On select, splice the
   command into `value` at `[from, to]` and advance the cursor via the `selection`
   prop. `formatSlashCommandArgumentHint` (`ComposerEditor.tsx:177`) renders
   per-row argument hints.

5. **Keyboard.** Keep the working `useKeyboardAttachment` (`SessionScreen.tsx:469`,
   defined `:1396`) and its sibling bottom-inset listener that feeds the DOM
   embed; render the suggestion list as an overlay above the existing animated
   composer card so composer ↔ WebView inset stay in lockstep. Defer any
   `react-native-keyboard-controller` migration to a gated follow-up (it has
   documented RN 0.81 / Fabric `KeyboardStickyView` regressions). Use
   `keyboardShouldPersistTaps='handled'` so command rows handle taps but
   outside-taps still dismiss; verify on Android that the post-select `selection`
   splice does not blur/refocus.

## Reuse strategy (verified)

**Reused losslessly (shared with desktop, already RN-safe):**

- Runtime contract `agents-runtime/src/composer-input.ts`:
  `COMPOSER_INPUT_MESSAGE_TYPE`, `ComposerInputPayload` / `ComposerNode` /
  `SlashCommandRow` types, `validateComposerInputPayload`,
  `getSlashCommandNodes`. Exported via `@electric-ax/agents-runtime/client`
  (`client.ts:29,37-40`). Note: `validateComposerInputPayload` is **not** in the
  `/client` barrel today; mobile likely does not need client-side validation
  (server validates) — add the one-line export only if required.
- Send pipeline `agents-server-ui/src/lib/sendMessage.ts`:
  `createSendComposerInputAction` (`:460`, wraps `createSendMessageAction`),
  `sendEntityMessage` (`:245`). Already imported by mobile.
- Discovery: the same `useLiveQuery(db.collections.slashCommands)` + static
  fallback pattern from `MessageInput.tsx:111`.

**Extracted in PR1 (pure logic lifted out of the DOM-only `ComposerEditor.tsx`
into `agents-runtime/src/composer-input.ts`, repointing all desktop call sites):**

- `serializeComposerInput` (`ComposerEditor.tsx:282`)
- `normalizeCommandName` (`:174`)
- `formatSlashCommandArgumentHint` (`:177`)
- The slash-command regexes — **note there are two distinct patterns across three
  sites**, so extract both as named constants and repoint all three:
  - token pattern, `/(^|\s)\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?=\s|$)/g` — used by
    the serializer (`:290`) and decorations (`:418`); case-sensitive, leading
    letter required.
  - trigger pattern, `/(^|\s)\/([a-z0-9_-]*)$/i` — used by `getSlashQuery`
    (`:451`); case-insensitive, no leading-letter requirement.
- Move `ComposerEditor.test.ts` with them; keep it green.

**Built new on mobile (native-only, no reusable desktop equivalent):** the
`TextInput` composer shell, `/`-trigger + query detection from
`value`/`onSelectionChange`, the keyboard-docked suggestion list, and
command-insertion-by-string-splice (vs ProseMirror `tr.replaceWith`).

**Not reused (DOM-only):** ProseMirror schema, `slash_call` atoms, decorations,
`getSlashQuery`/`coordsAtPos` popover positioning (`:954-955`), base-ui Popover,
CSS modules, `ComposerShell`.

## Corrections from research (verified against the tree)

1. **Slash-command discovery is NOT a blocker.** `slashCommands` is a built-in
   entity-stream-DB collection (`entity-schema.ts:970,1096`, event type
   `slash_command`), and mobile's `SessionScreen` already constructs/holds the
   entity stream `db` (`SessionScreen.tsx:174`). So
   `db.collections.slashCommands` is available natively today — **no**
   `createSlashCommandsCollection`, **no** `AgentsProvider` change. (The
   global collections mobile registers in `AgentsProvider.tsx:44-49` —
   entities/runners/users/permissions — are a separate concern.) Dynamically
   registered commands flow through this collection; statically declared ones
   come via the `fallbackSlashCommands` prop.

2. **"One shared serializer ⇒ payloads can't disagree" is false.** Desktop's
   actual submit path is `serializeComposerInputFromDoc` (`ComposerEditor.tsx:312`,
   called at `:1130`), which walks ProseMirror `slash_call` atoms; the regex
   `serializeComposerInput` is only its fallback (`:356`). Mobile will use the
   regex serializer on the source string. These can diverge (e.g. the token regex
   is `[a-z]`-only, so a doc-inserted `/PR-review` serializes on desktop but a
   typed one is dropped). Pick one in Open Question 1; pin the boundary with a
   cross-platform test, not prose.

3. **Dependency naming.** If we pursue inline pills (PR3),
   `react-native-live-markdown` needs `react-native-worklets` (≥0.7), not
   `react-native-reanimated` directly (Reanimated v4 split worklets out; the Babel
   plugin is `react-native-worklets/plugin`, auto-configured by
   `babel-preset-expo` — do not add it manually). Mobile currently has none of
   `reanimated` / `keyboard-controller` / `live-markdown` / `worklets`.

## Delivery plan

Three independently-shippable PRs so the two unproven native modules sit behind a
spike and never block the parity win.

- **PR1 — pure-logic extraction.** Lift the serializer + helpers + both regex
  constants into `composer-input.ts`, repoint desktop call sites, move the test.
  Low risk; no behavior change.
- **PR2 — the parity win (no new native deps).** `NativeComposer.tsx`: plain
  `TextInput` emitting `composer_input`, `/`-trigger detection, native
  keyboard-docked autocomplete on the **existing** keyboard plumbing,
  `useLiveQuery(db.collections.slashCommands)`. This delivers the in-session
  feature/experience parity. `NewSessionScreen` spawn parity is **deferred** (a
  follow-up): the mobile spawn endpoint takes a plain-string `initialMessage`
  with no `initialMessageType`, so a structured `composer_input` spawn needs
  server/`spawnEntity` plumbing that is out of v1 scope.
- **PR3 — inline `/command` pills (gated on the spike).** Add
  `react-native-live-markdown` + `react-native-worklets` and a worklet parser
  styling `/command` ranges. Drop if the spike fails — parity is already shipped.

**De-risking spike (≈half a day, before PR3 code):**

1. `npx expo install react-native-worklets react-native-reanimated
react-native-keyboard-controller` (let Expo pin SDK-54-compatible versions).
   On a **physical iOS** device, drop an auto-growing (40→200px) `TextInput` + a
   sticky bar; confirm worklets run on the UI thread on iOS **and** Android.
2. Mount a bare `MarkdownTextInput` with a trivial custom worklet parser styling
   one `/token` under React 19 + new arch. The worklet parser is a **second copy**
   of the token regex (a worklet cannot import the serializer) — add a fixture
   test asserting its token boundaries match the serializer's node offsets.
3. Check backspace-through-a-pill feel (ranges, not atoms — caret can land
   inside), `/command` autocorrect (turn `autoCorrect`/`autoCapitalize`/
   `spellCheck` off), and CJK/dictation re-highlight flicker.

Only if the spike passes do we commit PR3.

## Risks

- **Serializer divergence (Correction #2).** Mitigate with the chosen
  canonicalization + a cross-platform golden test.
- **live-markdown on Expo 54 / RN 0.81 / React 19 / new arch** is unverified;
  the spike de-risks it, and PR2 ships without it.
- **Queued-edit node flattening.** `createUpdateInboxMessageAction`
  (`sendMessage.ts:485`) carries `{ text }` only — a _pre-existing, shared_
  desktop limitation, not a mobile regression. For v1, disable inline edit for
  messages containing slash nodes so a user never watches a pill silently
  flatten; fix the contract as a separate shared PR if desired.
- **Vertical budget on small screens.** Cap the suggestion list with internal
  scroll and lower composer max-height when open; verify on iPhone SE landscape.

## Open questions

1. **Serializer canonicalization.** Repoint desktop's submit to the shared
   source-string serializer (one true source of truth + golden test), or scope
   v1 as "mobile emits the regex subset of what desktop can emit" and pin the
   divergence boundary with a test? (Recommend the latter for v1, the former as
   the durable end state.)
2. **Edit of slash-node messages.** Disable inline edit for slash-node messages
   in v1 (recommended), or fix `createUpdateInboxMessageAction` to carry nodes
   now (cross-platform contract change)?
3. **Keyboard library.** Confirm v1 keeps `useKeyboardAttachment` and only adds
   the overlay list (recommended), deferring any `keyboard-controller` swap to a
   gated follow-up?
4. **Future node types** (`file`/`symbol`/`branch`, already enum'd in
   `composer-input.ts`). Extract a generic trigger + string-splice spine
   (parameterized by node-kind + trigger char) in PR2 so these stay O(1), or
   defer? (Recommend extracting the spine now.)

## Verified reference map

| What                                | Where                                                                                                                                                                                                                                              |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime contract + types            | `agents-runtime/src/composer-input.ts` (`COMPOSER_INPUT_MESSAGE_TYPE:1`, nodes `:3-48`, payload `:55`, `validateComposerInputPayload:121`, `getSlashCommandNodes:233`)                                                                             |
| `/client` barrel                    | `agents-runtime/src/client.ts:29,37-40` (no `validateComposerInputPayload`)                                                                                                                                                                        |
| Desktop serializer + helpers        | `agents-server-ui/src/components/ComposerEditor.tsx` (`normalizeCommandName:174`, `formatSlashCommandArgumentHint:177`, `serializeComposerInput:282`, `serializeComposerInputFromDoc:312`, submit `:1130`, `getSlashQuery:445`, `coordsAtPos:954`) |
| Regexes                             | `ComposerEditor.tsx:290` & `:418` (token), `:451` (trigger)                                                                                                                                                                                        |
| Send actions                        | `agents-server-ui/src/lib/sendMessage.ts` (`sendEntityMessage:245`, `createSendMessageAction:351`, `createSendComposerInputAction:460`, `createUpdateInboxMessageAction:485`)                                                                      |
| Desktop discovery + fallback        | `agents-server-ui/src/components/MessageInput.tsx:111-123`; `views/ChatView.tsx:254`                                                                                                                                                               |
| Built-in `slashCommands` collection | `agents-runtime/src/entity-schema.ts:970,1096`                                                                                                                                                                                                     |
| Mobile holds entity stream `db`     | `agents-mobile/src/screens/SessionScreen.tsx:174` (uses it `:482,494,498,502`)                                                                                                                                                                     |
| Mobile current input / keyboard     | `SessionScreen.tsx` (`TextInput:11/714`, `createSendMessageAction:22/481`, `useKeyboardAttachment:469/1396`)                                                                                                                                       |
| Mobile global collections           | `agents-mobile/src/lib/AgentsProvider.tsx:44-49` (no `slashCommands` — and none needed)                                                                                                                                                            |
