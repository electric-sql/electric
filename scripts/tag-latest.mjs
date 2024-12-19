import { glob } from "glob"
import { readFileSync } from "fs"
import { execSync } from "child_process"

async function tagLatest() {
  // Find all package.json files in the packages directory
  const packageFiles = glob.sync("./packages/*/package.json")

  for (const file of packageFiles) {
    const pkg = JSON.parse(readFileSync(file))
    const { name, version, private: isPrivate } = pkg

    if (!name || !version || isPrivate) continue

    console.log(`Tagging ${name}@${version} as latest`)
    try {
      execSync(`npm dist-tag add ${name}@${version} latest`, {
        stdio: "inherit",
        env: { ...process.env },
      })
    } catch (e) {
      console.error(`Failed to tag ${name}@${version}:`, e)
      process.exit(1)
    }
  }
}

tagLatest().catch((e) => {
  console.error(e)
  process.exit(1)
})
