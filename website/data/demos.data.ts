import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'

export default {
  watch: [`../demos/*.md`],

  load(files) {
    const demos = files
      .map((file) => {
        const slug = path.basename(file, `.md`)

        const contents = fs.readFileSync(file, `utf-8`)
        const frontmatter = contents.split(`---\n`)[1]

        const data = parse(frontmatter)
        data.link = `/demos/${slug}`

        return data
      })
      .sort((a, b) => {
        return parseInt(a.order || `999`) - parseInt(b.order || `999`)
      })

    return {
      demos: demos.filter((x) => x.demo === true),
      homepage_demos: demos.filter((x) => x.homepage === true),
      examples: demos
        .filter((x) => x.demo !== true)
        .sort((a, b) => a.link.localeCompare(b.link)),
    }
  },
}
