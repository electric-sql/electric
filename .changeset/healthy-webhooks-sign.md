---
"@electric-ax/agents-server": patch
"@electric-ax/agents-runtime": patch
---

Update Durable Streams server webhook support to Ed25519/JWKS signatures. Agents-server now exposes its own stream-root JWKS endpoint, supports injectable webhook signing keys/signers, validates upstream Durable Streams webhook signatures, rewrites subscription signing metadata to the agents-server JWKS, re-signs forwarded webhook deliveries, and preserves bodyless upstream 204/205/304 subscription responses. Agents-runtime now validates webhook signatures before dispatching wakes.
