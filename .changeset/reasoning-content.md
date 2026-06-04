---
'@electric-ax/agents-server-ui': minor
'@electric-ax/agents-runtime': minor
'@electric-ax/agents': patch
'@electric-ax/agents-desktop': patch
---

Stream model reasoning / extended-thinking content into the UI. While
the model is "thinking" (Anthropic extended thinking, DeepSeek-R1
reasoning, Moonshot K2, OpenAI Responses summaries) the agent response
now shows the live reasoning text faded above the answer, with the
existing `Thinking` shimmer heading and an elapsed-time ticker. Once
the reasoning settles it collapses to `▸ Thought for 12s` — click to
expand. Multiple reasoning rows per run are rendered independently in
order, so tool-using turns show each step's reasoning separately.

Implementation:

- **Schema** — `reasoning` row gains `run_id`, `encrypted` (Anthropic
  redacted-thinking opaque payload, must round-trip back to the model
  verbatim), and `summary_title` (extracted at write time for
  providers that emit a bolded heading). New `reasoningDeltas`
  collection mirrors `textDeltas` for streamed content.
- **Bridge** — `OutboundBridge` gains `onReasoningStart` /
  `onReasoningDelta` / `onReasoningEnd`, parallel to the text path.
- **Adapter** — `pi-adapter.ts` routes pi-ai's `thinking_start` /
  `thinking_delta` / `thinking_end` events to the bridge, parses the
  `**Title**\n\n<body>` heading (OpenAI Responses only) once at
  `thinking_end` so the UI doesn't re-parse on every render.
- **Timeline** — `EntityTimelineRunRow` gains a live
  `reasoning: Collection<EntityTimelineReasoningItem>` with content
  built from a delta-join, mirroring `EntityTimelineTextItem`.
- **UI** — New `<ReasoningSection>` component renders above the
  answer in `AgentResponseLive`. Live shows faded markdown via
  `Streamdown` with `ThinkingIndicator` heading + summary title +
  elapsed-time ticker. Settled collapses to `Thought for Ns` with
  click-to-expand. Redacted Anthropic blocks render a single muted
  line — content is opaque, but the encrypted payload is still
  persisted server-side so the model gets it back next turn.

Providers without reasoning emit nothing → no reasoning section
rendered. Historical responses recorded before this PR have no
reasoning rows → no closure cue, same as today.
