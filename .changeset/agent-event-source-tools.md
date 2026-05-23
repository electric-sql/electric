---
"@electric-ax/agents-runtime": minor
"@electric-ax/agents-server": minor
"@electric-ax/agents": minor
---

Add agent event source contracts and dynamic event source subscription tools. Agents can list discoverable webhook-backed event sources, subscribe entities to resolved bucket streams with explicit lifetimes, and persist those subscriptions as manifest-backed wake registrations. Horton now receives these tools through the built-in agents runtime by default. Runtime-managed event source wakes now hydrate matching webhook rows into the agent trigger message so tool-created subscriptions include the event payload that caused the wake.
