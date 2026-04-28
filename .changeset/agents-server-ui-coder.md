---
"@electric-ax/agents-server-ui": patch
---

Coder-session UI improvements: a dedicated 3-tab Create / Attach / Import spawn dialog routed in from the sidebar's *New session* flow, a timeline view that shows queued user prompts immediately as a "queued" bubble (matched against canonical `user_message` events by text so they swap cleanly when the CLI mirrors the JSONL back), and a session header that surfaces the full `nativeSessionId` for copy/paste against on-disk session files.
