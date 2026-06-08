---
'@electric-ax/agents-mobile': patch
'@electric-ax/agents-runtime': patch
'@electric-ax/agents-server-ui': patch
---

agents-mobile: native slash-command composer for the Horton prompt. The in-session and new-session inputs gain slash-command autocomplete, structured `composer_input` payloads, and inline command/argument highlighting — reaching feature parity with the desktop composer, on a native `TextInput` rather than a WebView. The slash-command grammar and serializer move into `@electric-ax/agents-runtime` (exported via `/client`) as the shared source of truth for both surfaces; the desktop composer repoints to them with no behaviour change.
