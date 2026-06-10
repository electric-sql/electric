---
"@electric-ax/agents-mobile": patch
"@electric-ax/agents-server-ui": patch
---

Bring the mobile new-session and chat composers to parity with desktop:

- **Schema-driven spawn args + model/reasoning/speed controls.** The new-session screen now renders an agent type's `creation_schema` as native controls — enum properties become picker sheets (the model enum groups options by provider and remembers the last pick), booleans become switches, string/number become text fields, string-arrays a comma-separated field, and other objects a JSON field — so agents that need structured creation args can be configured and started from mobile (full parity with the desktop `SchemaForm`). Required fields gate the Start button.
- **Image attachments.** Both the in-session and new-session composers can attach images (photo library or camera) via `expo-image-picker`, gated on whether the session's model accepts image input. At spawn the first message is sent immediately after the entity is created so the upload can target it, mirroring the desktop flow. Attachments render in the chat log through the existing embedded timeline.

The shared `agents-server-ui` send path (`uploadMessageAttachments`) accepts React Native file descriptors alongside browser `File`s, and the new-session schema-classification helpers (`inlineSchemaProperties`, model/reasoning/speed detection, model-settings grouping) move into a reusable `lib/schemaProperties` module shared by desktop and mobile. No server changes.
