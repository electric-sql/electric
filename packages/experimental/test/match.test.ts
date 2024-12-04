import { describe, expect, inject } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { ShapeStream } from '@electric-sql/client'
import { testWithIssuesTable as it } from './support/test-context'

import { matchBy, matchStream } from '../src/match'

const BASE_URL = inject(`baseUrl`)

describe(`matchStream`, () => {
  it(`should match`, async ({ insertIssues, issuesTableUrl }) => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-nocheck
    const stream = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
      },
    })

    const id = uuidv4()
    const issue = {
      id: id,
      title: `test title`,
    }

    setTimeout(() => {
      insertIssues(issue)
    }, 10)

    const matchFn = matchBy(`id`, id)
    const result = await matchStream(stream, [`insert`], matchFn, 200)

    expect(result.value.title).toEqual(`test title`)
  })
})
