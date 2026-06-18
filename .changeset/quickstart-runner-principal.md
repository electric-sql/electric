---
"electric-ax": patch
"@electric-ax/agents": patch
"@electric-ax/agents-runtime": patch
"@electric-ax/agents-server-ui": patch
---

Fix Electric Agents quickstart startup by authenticating the built-in pull-wake runner with the same principal it registers as, registering built-in agent types with the local runner as their default dispatch target, and aligning the CLI's default principal with the local quickstart user. Pin the CLI-launched agents-server Docker image to the matching released agents-server version, improve registration fetch errors so startup failures include the endpoint and underlying cause, avoid the CLI observe live-query Collection boundary, and clarify browser-only credentials settings copy.
