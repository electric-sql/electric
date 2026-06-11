---
'@electric-ax/agents': patch
---

Stop forcing `store: true` on OpenAI Codex reasoning payloads. The ChatGPT-login Codex endpoint is stateless-only and rejects stateful requests with `{"detail":"Store must be set to false"}`, which broke every Codex (`gpt-5.x`) run. The stateful default now applies to the regular OpenAI Responses API only.
