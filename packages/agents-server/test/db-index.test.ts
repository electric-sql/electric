import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveMigrationsFolder } from '../src/db/index'

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  `..`
)
const expectedMigrationsFolder = path.join(packageRoot, `drizzle`)

describe(`resolveMigrationsFolder`, () => {
  it(`finds migrations from the source db module location`, () => {
    const sourceUrl = pathToFileURL(
      path.join(packageRoot, `src/db/index.ts`)
    ).href

    expect(resolveMigrationsFolder(sourceUrl)).toBe(expectedMigrationsFolder)
  })

  it(`finds migrations from the bundled dist module location`, () => {
    const distUrl = pathToFileURL(path.join(packageRoot, `dist/index.js`)).href

    expect(resolveMigrationsFolder(distUrl)).toBe(expectedMigrationsFolder)
  })
})
