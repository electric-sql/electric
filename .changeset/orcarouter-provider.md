---
'@electric-ax/agents-runtime': patch
'@electric-ax/agents': patch
'@electric-ax/agents-server-ui': patch
'@electric-ax/agents-desktop': patch
---

Add OrcaRouter as a named provider. Mirrors the Moonshot OpenAI-compatible gateway wiring: new `orcarouter-models.ts` (4 gateway models routed to `https://api.orcarouter.ai/v1`), `ORCAROUTER_API_KEY` env detection, low-cost model support, and model-catalog integration so the desktop/server UI can pick OrcaRouter models.
