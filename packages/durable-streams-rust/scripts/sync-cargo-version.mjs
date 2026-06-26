// Sync the crate version in Cargo.toml from package.json — the changeset-managed
// anchor. package.json is the single source of truth (bumped by changesets); this
// propagates that version to Cargo.toml before `cargo publish` / Docker build so
// all release channels (npm, crates.io, Docker) ship the same version.
//
// Run from the package root: `node scripts/sync-cargo-version.mjs` (or
// `pnpm sync-version`).
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), `..`)
const { version } = JSON.parse(readFileSync(join(root, `package.json`), `utf8`))
if (!version) throw new Error(`package.json has no version`)

const cargoPath = join(root, `Cargo.toml`)
const cargo = readFileSync(cargoPath, `utf8`)

// Replace the `[package]` version: the first line-anchored `version = "..."`.
// Dependency versions are written `foo = { version = "..." }` (not line-anchored),
// so this matches only the crate's own version.
const next = cargo.replace(/^version = "[^"]*"/m, `version = "${version}"`)
if (next === cargo && !cargo.includes(`version = "${version}"`)) {
  throw new Error(
    `sync-cargo-version: did not find a [package] version to update`
  )
}
writeFileSync(cargoPath, next)
console.log(`Cargo.toml version → ${version}`)
