---
'@electric-ax/agents': patch
'@electric-ax/agents-desktop': patch
'@electric-ax/agents-runtime': patch
'@electric-ax/agents-server': patch
'@electric-ax/agents-server-ui': patch
---

Add OpenAI realtime voice mode for Electric Agents, backed by durable audio/control streams. Horton can enter realtime mode with normal context and tools, desktop exposes realtime model/voice/reasoning settings, the server/runtime persist session stream refs, transcripts, and audio spans, and the UI adds voice controls, typed-message forwarding, credential gating, input metering, new-session voice startup, and audio capture/playback fixes.
