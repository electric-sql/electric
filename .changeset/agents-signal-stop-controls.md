---
'@electric-ax/agents-runtime': minor
'@electric-ax/agents-server': minor
'@electric-ax/agents-server-ui': minor
---

Add durable entity signals and signal-driven stop controls for agents. The server and runtime now expose signal APIs, persist signal events, and let the UI send `SIGINT` to cancel active generations with pending stop feedback.
