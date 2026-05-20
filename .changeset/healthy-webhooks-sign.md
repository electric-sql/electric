---
"@electric-ax/agents-server": patch
"@electric-ax/agents-runtime": patch
---

Update Durable Streams server webhook support to Ed25519/JWKS signatures. Agents-server now exposes its own stream-root JWKS endpoint, supports injectable webhook signing keys/signers, rewrites subscription signing metadata to the agents-server JWKS, and re-signs forwarded webhook deliveries. Agents-runtime now validates webhook signatures before dispatching wakes.
