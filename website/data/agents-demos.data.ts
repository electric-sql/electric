import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import type {
  DemoListRow,
  DemosPayload,
  HomepageDemoCard,
  YamlRecord,
} from '../src/types/data-loaders'

function isHomepageDemoCard(row: DemoListRow): row is HomepageDemoCard {
  return (
    typeof row.title === `string` &&
    typeof row.description === `string` &&
    typeof row.link === `string`
  )
}

export default {
  watch: [`../agents/demos/*.md`],

  load(files: string[]): DemosPayload {
    const demos = files
      .filter((file) => path.basename(file) !== `index.md`)
      .map((file) => {
        const slug = path.basename(file, `.md`)

        const contents = fs.readFileSync(file, `utf-8`)
        const frontmatter = contents.split(`---\n`)[1]

        const base = parse(frontmatter) as YamlRecord
        const row: DemoListRow = {
          ...base,
          link: `/agents/demos/${slug}`,
        }

        return row
      })
      .sort(
        (a, b) =>
          parseInt(a.order || `999`, 10) - parseInt(b.order || `999`, 10)
      )

    return {
      demos: demos.filter((x) => x.demo === true),
      homepage_demos: demos
        .filter((x) => x.homepage === true)
        .filter(isHomepageDemoCard),
      examples: demos
        .filter((x) => x.demo !== true)
        .sort((a, b) => a.link.localeCompare(b.link)),
    }
  },
}
