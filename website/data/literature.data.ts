import fs from 'node:fs'
import { parse } from 'yaml'

export default {
  watch: ['./literature/papers.yaml'],

  load (files) {
    const contents = fs.readFileSync(files[0], 'utf-8')

    return parse(contents)
  }
}
