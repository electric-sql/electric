---
"@electric-ax/agents-runtime": patch
"@electric-ax/agents-server": patch
"@electric-ax/agents-server-ui": patch
"@electric-ax/agents": patch
---

Add manifest-backed attachments for agents.

Attachments are uploaded through entity routes, stored in private attachment streams, referenced by manifest entries, and exposed to runtime handlers through `ctx.attachments`. The server UI can attach image files to user messages, renders message attachments with generic preview/download links, exposes image previews from attachment manifest rows, and hides image attachment controls for models whose registered pi-ai metadata does not include image input. Horton title generation now also works when the first user message is sent after attachment upload, including image-only starts.
