import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import type { UseCaseListRow, YamlRecord } from '../src/types/data-loaders'

export default {
  watch: [`../use-cases/*.md`],

  load(files: string[]) {
    return files
      .map((file) => {
        const slug = path.basename(file, `.md`)

        const contents = fs.readFileSync(file, `utf-8`)
        const frontmatter = contents.split(`---\n`)[1]

        const base = parse(frontmatter) as YamlRecord
        const row: UseCaseListRow = {
          ...base,
          link: `/use-cases/${slug}`,
        }

        return row
      })
      .filter((x) => x.homepage)
      .sort((a, b) => {
        const orderA = parseInt(a.homepage_order ?? `0`, 10)
        const orderB = parseInt(b.homepage_order ?? `0`, 10)
        return orderA - orderB
      })
  },
}
