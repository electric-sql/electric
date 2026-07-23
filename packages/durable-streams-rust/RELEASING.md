# Releasing

> **npm publishing is currently disabled.** A release publishes the crate
> (crates.io) and the Docker image, but **not** the npm packages — the `npm-publish`
> job in `server_rust_publish.yml` is gated off (search `DISABLED:`). Re-enable it
> when ready to ship the npm packages. (The merge-time canary Docker build is also
> off; the release image still publishes.)

Released via Changesets, like the rest of the monorepo. The version lives in this
package's `package.json` (the `@electric-ax/durable-streams-server-rust` anchor,
`private: true` — Changesets bumps it but does not publish it; CI publishes the
real binary packages). To cut a release: add a changeset for this package and
merge the "Version Packages" PR. On the version bump, `changesets_release.yml`
fans out to publish all three channels at that version:

- **crates.io** — the `durable-streams` crate (`cargo install durable-streams`),
  via `server_rust_publish.yml`. `Cargo.toml`'s version is synced from
  `package.json` at publish time (`scripts/sync-cargo-version.mjs`).
- **npm** — `@electric-ax/durable-streams-server-rust` plus its four platform
  packages (built per target, assembled by `npm/assemble.mjs`).
- **Docker Hub** — `electricax/durable-streams-server-rust` (multi-arch), via
  `server_rust_dockerhub_image.yml`.

Both registries authenticate via OIDC trusted publishing, so CI stores no registry
tokens. The `durable-streams` crate is reserved and its crates.io Trusted Publishing
is configured. The npm trusted publishers still need configuring before npm
publishing is re-enabled.
