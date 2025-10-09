import fs from "node:fs"
import path from "node:path"
import { parse } from "yaml"

export default {
  watch: [`../blog/posts/*.md`],

  load(files) {
    return files
      .map((file) => {
        const base = path.basename(file, `.md`)
        const parts = base.split(`-`)

        const year = parts[0]
        const month = parts[1]
        const day = parts[2]
        const slug = parts.slice(3, 99).join(`-`)

        const contents = fs.readFileSync(file, `utf-8`)
        const frontmatter = contents.split(`---\n`)[1]

        const data = parse(frontmatter)
        const excerpt =
          data.excerpt ||
          contents.split(`---\n`)[2].split(`<!--truncate-->`)[0].trim()

        data.date = `${year}-${month}-${day}`
        data.path = `/blog/${year}/${month}/${day}/${slug}`
        data.excerpt = excerpt

        return data
      })
      .filter((x) => x.published !== false)
      .sort((a, b) => (a.path < b.path ? 1 : -1))
  },
}
