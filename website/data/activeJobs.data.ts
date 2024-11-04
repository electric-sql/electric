import fs from 'node:fs'
import { parse } from 'yaml'

export default {
  watch: ['../about/jobs/*.md'],

  load (files) {
    return files.map((file) => {
      const slug = file.split('/about/jobs/')[1].split('.')[0]

      const contents = fs.readFileSync(file, 'utf-8')
      const frontmatter = contents.split('---\n')[1]

      const data = parse(frontmatter)
      data.link = `/about/jobs/${slug}`

      return data
    }).filter(x => x.active)
  }
}
