---
'@electric-ax/agents-runtime': minor
'@electric-ax/agents-server': minor
'@electric-ax/agents-server-ui': minor
'@electric-ax/agents-server-conformance-tests': patch
'electric-ax': patch
---

Add durable entity signals and signal-driven stop controls for agents. The server, runtime, conformance tests, and CLI now use signal APIs, persist signal events, and let the UI send `SIGINT` to cancel active generations with pending stop feedback.
