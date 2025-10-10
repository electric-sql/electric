import fs from 'node:fs'
import { parse } from 'yaml'

export default {
  watch: ['./blog/authors.yaml'],

  load (files) {
    const contents = fs.readFileSync(files[0], 'utf-8')

    return parse(contents)
  }
}
