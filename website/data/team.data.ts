import fs from "node:fs"
import path from "node:path"
import { parse } from "yaml"

export default {
  watch: ["./team/*.yaml"],

  load(files) {
    result = {}

    files.forEach((file) => {
      const slug = path.basename(file, ".yaml")

      const contents = fs.readFileSync(file, "utf-8")
      const items = parse(contents).filter((x) => x.published)

      result[slug] = items
    })

    return result
  },
}
