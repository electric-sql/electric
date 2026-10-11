---
"@electric-ax/agents-runtime": patch
---

Fix `composer_input` messages reaching the agent as raw JSON. `buildInboxMessages` dropped the `message_type` field when materializing the entity timeline from the db, so `projectInboxPayload` could no longer recognize composer input and fell back to `JSON.stringify(payload)` — the model saw `{"source":"..."}` instead of the plain text the user typed. The field is now carried through.
