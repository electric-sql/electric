import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import type { TeamMemberStub } from '../src/types/data-loaders'

function parseTeamList(raw: string): TeamMemberStub[] {
  return parse(raw) as TeamMemberStub[]
}

function isPublishedMember(
  x: TeamMemberStub
): x is TeamMemberStub & { published: true } {
  return x.published === true
}

export default {
  watch: [`./team/*.yaml`],

  load(files: string[]) {
    const result: Record<string, unknown> = {}

    files.forEach((file: string) => {
      const slug = path.basename(file, `.yaml`)

      const contents = fs.readFileSync(file, `utf-8`)
      const list = parseTeamList(contents)
      const items = list.filter(isPublishedMember)

      result[slug] = items
    })

    return result
  },
}
