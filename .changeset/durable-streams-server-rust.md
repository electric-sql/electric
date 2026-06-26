---
'@electric-ax/durable-streams-server-rust': patch
---

Import the high-performance Rust Durable Streams server as
`@electric-ax/durable-streams-server-rust`. Released via Changesets (the anchor is
`private`, so Changesets bumps the version and CI publishes the binary packages):
npm (main + four platform packages), the `durable-streams` crate on crates.io, and
a multi-arch `electricax/durable-streams-server-rust` Docker image. Adds a Rust
build/test/clippy + conformance-matrix CI workflow and a distroless Dockerfile.
