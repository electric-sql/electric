#!/usr/bin/env node
/**
 * Operator hygiene: list and optionally delete docker volumes whose name
 * starts with `coding-agent-workspace-`. The MVP `LocalDockerProvider`
 * intentionally does NOT remove volumes on `destroy()` because the same
 * volume needs to survive idle eviction → resume cycles. After the
 * agent's terminal DELETE, however, the volume is orphaned indefinitely.
 *
 * Usage:
 *   pnpm cleanup:volumes              # dry-run, lists matches
 *   pnpm cleanup:volumes --delete     # actually delete
 *   pnpm cleanup:volumes --in-use     # include even volumes still mounted
 *
 * By default volumes that are still in use by a container are skipped
 * (deletion would fail). `--in-use` widens the listing for visibility.
 */
import { spawnSync } from 'node:child_process'

const PREFIX = `coding-agent-workspace-`

interface DockerVolume {
  name: string
  inUse: boolean
}

function listMatchingVolumes(): Array<DockerVolume> {
  const list = spawnSync(
    `docker`,
    [`volume`, `ls`, `--format`, `{{.Name}}`, `--filter`, `name=${PREFIX}`],
    { encoding: `utf-8` }
  )
  if (list.status !== 0) {
    console.error(`docker volume ls failed:`, list.stderr)
    process.exit(2)
  }
  const names = list.stdout
    .split(`\n`)
    .map((s) => s.trim())
    .filter(Boolean)
  // For each volume, check if it's mounted by any container.
  return names.map((name) => {
    const mounts = spawnSync(
      `docker`,
      [
        `ps`,
        `-a`,
        `--filter`,
        `volume=${name}`,
        `--format`,
        `{{.ID}}`,
        `--no-trunc`,
      ],
      { encoding: `utf-8` }
    )
    const inUse =
      mounts.status === 0 &&
      mounts.stdout.split(`\n`).filter(Boolean).length > 0
    return { name, inUse }
  })
}

function deleteVolume(name: string): boolean {
  const r = spawnSync(`docker`, [`volume`, `rm`, name], { encoding: `utf-8` })
  if (r.status !== 0) {
    console.error(`  delete failed: ${r.stderr.trim()}`)
    return false
  }
  return true
}

function main(): void {
  const doDelete = process.argv.includes(`--delete`)
  const includeInUse = process.argv.includes(`--in-use`)

  const all = listMatchingVolumes()
  const candidates = includeInUse ? all : all.filter((v) => !v.inUse)

  if (all.length === 0) {
    console.log(`No volumes matching '${PREFIX}'.`)
    return
  }

  console.log(`Found ${all.length} volumes matching '${PREFIX}':`)
  let deleted = 0
  for (const v of all) {
    const tag = v.inUse ? ` [in-use]` : ``
    console.log(`  ${v.name}${tag}`)
    if (doDelete && (!v.inUse || includeInUse)) {
      if (deleteVolume(v.name)) {
        console.log(`    deleted`)
        deleted++
      }
    }
  }
  const skippedInUse = all.length - candidates.length
  console.log(
    `Total: ${all.length} matched, ${deleted} ${
      doDelete ? `deleted` : `would-be-deleted (use --delete)`
    }${skippedInUse > 0 ? `, ${skippedInUse} in-use skipped (use --in-use)` : ``}`
  )
}

main()
