import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import type { PostFrontmatter, PostListRow } from '../src/types/data-loaders'

function parsePostFrontmatter(raw: string): PostFrontmatter {
  return parse(raw) as PostFrontmatter
}

export default {
  watch: [`../blog/posts/*.md`],

  load(files: string[]) {
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

        const parsed = parsePostFrontmatter(frontmatter)
        const excerpt = typeof parsed.excerpt === `string` ? parsed.excerpt : ``
        const bodyExcerpt = contents
          .split(`---\n`)[2]
          .split(`<!--truncate-->`)[0]
          .trim()
        const resolvedExcerpt = excerpt || bodyExcerpt

        const date = `${year}-${month}-${day}`
        const blogPath = `/blog/${year}/${month}/${day}/${slug}`

        return {
          ...parsed,
          date,
          path: blogPath,
          excerpt: resolvedExcerpt,
        } satisfies PostListRow
      })
      .filter((row) => row.published !== false)
      .sort((a, b) => (a.path < b.path ? 1 : -1))
  },
}
