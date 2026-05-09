import { copyFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
const iconBuilderBin = require.resolve(`electron-icon-builder/index.js`)
const outputDir = join(packageDir, `build`)
const baseIcon = join(packageDir, `assets`, `icon.png`)
const macIcon = join(packageDir, `assets`, `icon-mac.png`)
const macOnlyOutputDir = join(packageDir, `build-mac-icon`)

function runIconBuilder(input, output) {
  execFileSync(
    process.execPath,
    [iconBuilderBin, `--input`, input, `--output`, output],
    {
      cwd: packageDir,
      stdio: `inherit`,
    }
  )
}

rmSync(outputDir, { recursive: true, force: true })
rmSync(macOnlyOutputDir, { recursive: true, force: true })

// Build Windows/Linux icons from the general source icon.
runIconBuilder(baseIcon, outputDir)

// Build macOS separately so the .icns uses the mac-specific rounded icon.
runIconBuilder(macIcon, macOnlyOutputDir)
copyFileSync(
  join(macOnlyOutputDir, `icons`, `mac`, `icon.icns`),
  join(outputDir, `icons`, `mac`, `icon.icns`)
)

rmSync(macOnlyOutputDir, { recursive: true, force: true })
