import fs from 'fs'
import { LIB_VERSION } from '../../version'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * Reads and parses the contents of the package.json of the CLI itself
 */
function readPackageJson(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(
      path.join(
        fileURLToPath(import.meta.url),
        '..',
        '..',
        '..',
        '..',
        'package.json'
      ),
      'utf8'
    )
  )
}

/**
 * Check whether the CLI is a canary release.
 *
 * The LIB_VERSION export does not update for canary releases
 * so this uses the package.json explicitly for this check
 */
export function isCanaryRelease(): boolean {
  return (readPackageJson().version as string).includes('canary')
}

export const LIB_MINOR_VERSION = LIB_VERSION.split('.').slice(0, 2).join('.')
