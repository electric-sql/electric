---
title: Attachments
titleTemplate: "... - Electric Agents"
description: >-
  Upload, reference, read, and hydrate files and images for Electric Agents entities.
outline: [2, 3]
---

# Attachments

Attachments are files associated with an entity. They are uploaded through entity routes, stored in private attachment streams, and referenced by `manifest` rows on the entity stream.

Attachments are useful for image inputs, user-uploaded files, generated artifacts, and tool outputs that should be tracked alongside the entity timeline.

## Upload from clients

Use `createRuntimeServerClient().createAttachment()`:

```ts
import { createRuntimeServerClient } from "@electric-ax/agents-runtime"

const client = createRuntimeServerClient({
  baseUrl: "http://localhost:4437",
  principalKey: "user:sam",
})

const { attachment } = await client.createAttachment({
  entityUrl: "/horton/onboarding",
  attachment: {
    bytes: imageBytes,
    mimeType: "image/png",
    filename: "screenshot.png",
    subject: { type: "inbox", key: "message-1" },
    role: "input",
    meta: { source: "upload" },
  },
})
```

The server writes a manifest entry like:

```ts
interface ManifestAttachmentEntry {
  kind: "attachment"
  id: string
  streamPath: string
  status: "pending" | "complete" | "failed"
  subject: {
    type: "inbox" | "run" | "text" | "tool_call" | "context"
    key: string
  }
  role: "input" | "output"
  mimeType: string
  filename?: string
  byteLength?: number
  sha256?: string
  createdAt: string
  createdBy?: string
  error?: string
  meta?: Record<string, JsonValue>
}
```

## Read from clients

Read bytes by entity URL and attachment id:

```ts
const bytes = await client.readAttachment({
  entityUrl: "/horton/onboarding",
  id: attachment.id,
})
```

The caller needs read access to the entity.

## Handler API

Handlers access attachments through `ctx.attachments`:

```ts
async handler(ctx) {
  const inputs = ctx.attachments.list({ role: "input" })
  const first = inputs[0]
  if (!first) return

  const bytes = await ctx.attachments.read(first.id)
  // Use bytes in a custom tool or external API call.
}
```

Available operations:

| Method | Purpose |
| ------ | ------- |
| `list(filter?)` | List manifest-backed attachments, optionally by role or subject. |
| `get(id)` | Return one attachment manifest entry by id. |
| `read(id)` | Read attachment bytes. |
| `create(input)` | Create a new attachment associated with this entity. |

## Subjects and roles

The `subject` links an attachment to the timeline object it belongs to:

| Subject type | Typical use |
| ------------ | ----------- |
| `inbox`      | User-uploaded input attached to a message |
| `run`        | Artifact associated with an agent run |
| `text`       | File linked to generated text |
| `tool_call`  | Tool input or output artifact |
| `context`    | Durable context material |

`role` is either `input` or `output`. Input attachments are usually supplied by users or the host app. Output attachments are usually created by handlers or tools.

## Images in agent context

When image attachments are associated with inbox messages, the runtime can hydrate supported image inputs into model messages. The UI should hide image upload controls for models that do not advertise image input support.

To keep context bounded, image hydration uses newest-first byte/count guardrails. Large or older images may remain as attachment descriptors rather than inline model content.

## Failure and rollback

Attachment uploads can fail independently of message sends. UI flows should roll back uploaded attachments if the send that references them fails, or leave an explicit failed manifest row when the failure should be visible to the entity.

## Related APIs

- [`HandlerContext`](../reference/handler-context) documents `ctx.attachments`.
- [`Built-in collections`](../reference/built-in-collections) documents attachment manifest rows.
- [`Programmatic runtime client`](./programmatic-runtime-client) documents `createAttachment()` and `readAttachment()`.
