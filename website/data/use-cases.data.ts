import fs from 'node:fs'
import { parse } from 'yaml'

export default {
  watch: ['../use-cases/*.md'],

  load (files) {
    return files.map((file) => {
      const slug = file.split('/use-cases/')[1].split('.')[0]

      const contents = fs.readFileSync(file, 'utf-8')
      const frontmatter = contents.split('---\n')[1]

      const data = parse(frontmatter)
      data.link = `/use-cases/${slug}`

      return data
    }).filter(x => x.homepage)
      .sort((a, b) => {
        return parseInt(a.homepage_order) - parseInt(b.homepage_order)
      })
  }
}
