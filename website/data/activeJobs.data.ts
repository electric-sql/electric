import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'

export default {
  watch: [`../about/jobs/*.md`],

  load(files) {
    return files
      .map((file) => {
        const slug = path.basename(file, `.md`)

        const contents = fs.readFileSync(file, `utf-8`)
        const frontmatter = contents.split(`---\n`)[1]

        const data = parse(frontmatter)
        data.link = `/about/jobs/${slug}`

        return data
      })
      .filter((x) => x.active)
  },
}
