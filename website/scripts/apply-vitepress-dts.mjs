import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const outRoot = join(root, 'node_modules', 'vitepress', 'dist', 'client')
const srcRoot = join(root, 'patch-assets', 'vitepress', 'dist', 'client')
const paths = [
  'shared.d.ts',
  'theme-default/support/utils.d.ts',
  'theme-default/composables/sidebar.d.ts',
]

if (!existsSync(outRoot)) {
  process.exit(0)
}
for (const p of paths) {
  const from = join(srcRoot, p)
  const to = join(outRoot, p)
  if (existsSync(from)) {
    mkdirSync(dirname(to), { recursive: true })
    cpSync(from, to)
  }
}
