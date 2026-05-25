---
"@electric-ax/agents-runtime": patch
"@electric-ax/agents-server": patch
"@electric-ax/agents": patch
---

Add agent event source contracts and dynamic event source subscription tools. Agents can list active, agent-visible webhook-backed event sources, subscribe entities to resolved bucket streams with explicit lifetimes, and persist those subscriptions as manifest-backed wake registrations. Bucket params are validated against the advertised `paramsSchema` before a subscription is accepted. Horton now receives these tools through the built-in agents runtime by default. Runtime-managed event source wakes now hydrate matching webhook rows into the agent trigger message so tool-created subscriptions include the event payload that caused the wake.
