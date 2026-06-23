# Server-rust release bootstrap (one-time)

Trusted publishing on both registries requires the package/crate to exist before a
trusted publisher can be attached. So the FIRST release is done manually with
temporary tokens; every release after is driven by pushing a `server-rust-v*` tag
with no stored secrets.

**Version note:** both registries refuse to overwrite an already-published version.
The manual bootstrap below publishes whatever version `packages/server-rust/Cargo.toml`
currently declares — so bump `Cargo.toml` to the version you intend to bootstrap
before starting, and use that same version for the npm packages. The next
tag-driven release must then bump `Cargo.toml` again (the `assert-version` job
enforces tag == `Cargo.toml`).

## crates.io (crate `durable-streams`)

1. Sign in to crates.io with GitHub and verify your email.
2. Create a scoped API token; `cargo login <token>`.
3. From `packages/server-rust/`: `cargo publish --locked` (publishes the first version).
4. Delegate ownership to the org and keep yourself as a named owner:
   - Ensure crates.io has `read:org` for electric-sql (granted).
   - `cargo owner --add github:electric-sql:core`
   - (You remain a named owner — team owners cannot manage owners or trusted publishers.)
5. On the crate's crates.io **Settings → Trusted Publishing**, add:
   - Repository: `durable-streams/durable-streams`
   - Workflow: `release-server-rust.yml`
   - Environment: (leave blank)
   - Optionally enable "require trusted publishing".
6. Revoke the temporary API token.

## npm (5 packages)

1. With a granular automation token that can publish to the `@durable-streams` scope,
   publish each package once so it exists on the registry. Easiest: run the assemble
   step locally against the 4 built binaries, then `npm publish <dir> --access public`
   for each of the 4 platform dirs and `main`.
2. On npmjs.com, for EACH of the 5 packages, configure **Trusted Publisher**:
   - GitHub repository: `durable-streams/durable-streams`
   - Workflow filename: `release-server-rust.yml`
3. Revoke the automation token.

## After bootstrap

`git tag server-rust-v<X.Y.Z> && git push origin server-rust-v<X.Y.Z>` publishes all
three channels with no secrets. The tag version must equal `Cargo.toml`'s `version`
(the `assert-version` job enforces this).
