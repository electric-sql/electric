import fs from 'node:fs'
import { parse } from 'yaml'

export default {
  watch: ['./team/*.yaml'],

  load (files) {
    result = {}

    files.forEach((file) => {
      const slug = file.split('/team/')[1].split('.')[0]

      const contents = fs.readFileSync(file, 'utf-8')
      const items = parse(contents).filter(x => x.published)

      result[slug] = items
    })

    return result
  }
}
