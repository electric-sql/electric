import fs from 'node:fs'
import { parse } from 'yaml'

export default {
  watch: [`./primitives/primitives.yaml`],

  load(files: string[]) {
    const contents = fs.readFileSync(files[0], `utf-8`)

    return parse(contents)
  },
}
