import { PGlite } from "@electric-sql/pglite"
import { type PGliteWithLive, live } from "@electric-sql/pglite/live"
import { electricSync } from "@electric-sql/pglite-sync"
import localSchemaMigrations from "./local-schema.sql?raw"
import { TODOS_URL } from "../../shared/app/config"

const DATA_DIR = "idb://electric-write-patterns-example"

const registry = new Map<string, Promise<PGliteWithLive>>()

export default async function loadPGlite(): Promise<PGliteWithLive> {
  let loadingPromise = registry.get("loadingPromise")

  if (loadingPromise === undefined) {
    loadingPromise = _loadPGlite()

    registry.set("loadingPromise", loadingPromise)
  }

  return loadingPromise as Promise<PGliteWithLive>
}

async function _loadPGlite(): Promise<PGliteWithLive> {
  const pglite: PGliteWithLive = await PGlite.create(DATA_DIR, {
    extensions: {
      electric: electricSync(),
      live,
    },
  })

  await pglite.exec(localSchemaMigrations)

  await pglite.electric.syncShapeToTable({
    shape: {
      url: TODOS_URL,
    },
    shapeKey: "todos",
    table: "todos_synced",
    primaryKey: ["id"],
  })

  return pglite
}
