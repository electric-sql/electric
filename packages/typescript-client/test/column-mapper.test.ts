import { describe, expect, it } from 'vitest'
import {
  snakeToCamel,
  camelToSnake,
  createColumnMapper,
  snakeCamelMapper,
  encodeWhereClause,
} from '../src/column-mapper'
import type { Schema } from '../src/types'

describe(`snakeToCamel`, () => {
  it(`should convert snake_case to camelCase`, () => {
    expect(snakeToCamel(`user_id`)).toBe(`userId`)
    expect(snakeToCamel(`project_id`)).toBe(`projectId`)
    expect(snakeToCamel(`created_at`)).toBe(`createdAt`)
    expect(snakeToCamel(`updated_at`)).toBe(`updatedAt`)
  })

  it(`should handle single words`, () => {
    expect(snakeToCamel(`id`)).toBe(`id`)
    expect(snakeToCamel(`name`)).toBe(`name`)
  })

  it(`should handle multiple underscores`, () => {
    expect(snakeToCamel(`user_profile_image_url`)).toBe(`userProfileImageUrl`)
    expect(snakeToCamel(`a_b_c_d`)).toBe(`aBCD`)
  })
})

describe(`camelToSnake`, () => {
  it(`should convert camelCase to snake_case`, () => {
    expect(camelToSnake(`userId`)).toBe(`user_id`)
    expect(camelToSnake(`projectId`)).toBe(`project_id`)
    expect(camelToSnake(`createdAt`)).toBe(`created_at`)
    expect(camelToSnake(`updatedAt`)).toBe(`updated_at`)
  })

  it(`should handle single words`, () => {
    expect(camelToSnake(`id`)).toBe(`id`)
    expect(camelToSnake(`name`)).toBe(`name`)
  })

  it(`should handle multiple capital letters`, () => {
    expect(camelToSnake(`userProfileImageURL`)).toBe(`user_profile_image_u_r_l`)
  })
})

describe(`createColumnMapper`, () => {
  it(`should create a mapper with explicit column mapping`, () => {
    const mapper = createColumnMapper({
      user_id: `userId`,
      project_id: `projectId`,
      created_at: `createdAt`,
    })

    expect(mapper.decode({ user_id: 1, project_id: 2, created_at: `2025-01-01` }))
      .toEqual({ userId: 1, projectId: 2, createdAt: `2025-01-01` })

    expect(mapper.encode(`userId`)).toBe(`user_id`)
    expect(mapper.encode(`projectId`)).toBe(`project_id`)
    expect(mapper.encode(`createdAt`)).toBe(`created_at`)
  })

  it(`should pass through unmapped columns`, () => {
    const mapper = createColumnMapper({
      user_id: `userId`,
    })

    expect(mapper.decode({ user_id: 1, name: `John`, age: 30 }))
      .toEqual({ userId: 1, name: `John`, age: 30 })
  })

  it(`should provide reverse mapping`, () => {
    const mapper = createColumnMapper({
      user_id: `userId`,
      project_id: `projectId`,
    })

    expect(mapper.mapping).toEqual({
      userId: `user_id`,
      projectId: `project_id`,
    })
  })

  it(`should return original column name if not in mapping`, () => {
    const mapper = createColumnMapper({
      user_id: `userId`,
    })

    expect(mapper.encode(`unknownColumn`)).toBe(`unknownColumn`)
  })
})

describe(`snakeCamelMapper`, () => {
  it(`should create a dynamic mapper without schema`, () => {
    const mapper = snakeCamelMapper()

    expect(mapper.decode({ user_id: 1, project_id: 2 }))
      .toEqual({ userId: 1, projectId: 2 })

    expect(mapper.encode(`userId`)).toBe(`user_id`)
    expect(mapper.encode(`projectId`)).toBe(`project_id`)
  })

  it(`should create a mapper with explicit mapping from schema`, () => {
    const schema: Schema = {
      user_id: { type: `int4` },
      project_id: { type: `int4` },
      created_at: { type: `timestamptz` },
    }

    const mapper = snakeCamelMapper(schema)

    expect(mapper.decode({ user_id: 1, project_id: 2, created_at: `2025-01-01` }))
      .toEqual({ userId: 1, projectId: 2, createdAt: `2025-01-01` })

    expect(mapper.encode(`userId`)).toBe(`user_id`)
    expect(mapper.encode(`projectId`)).toBe(`project_id`)
    expect(mapper.encode(`createdAt`)).toBe(`created_at`)
  })
})

describe(`encodeWhereClause`, () => {
  const encode = (col: string) => camelToSnake(col)

  it(`should encode simple WHERE clauses`, () => {
    expect(encodeWhereClause(`userId = $1`, encode))
      .toBe(`user_id = $1`)

    expect(encodeWhereClause(`projectId = $1 AND userId = $2`, encode))
      .toBe(`project_id = $1 AND user_id = $2`)
  })

  it(`should not encode SQL keywords`, () => {
    expect(encodeWhereClause(`userId IS NULL`, encode))
      .toBe(`user_id IS NULL`)

    expect(encodeWhereClause(`userId IN ($1, $2)`, encode))
      .toBe(`user_id IN ($1, $2)`)

    expect(encodeWhereClause(`userId LIKE $1`, encode))
      .toBe(`user_id LIKE $1`)
  })

  it(`should handle function calls`, () => {
    expect(encodeWhereClause(`LOWER(userName) = $1`, encode))
      .toBe(`LOWER(user_name) = $1`)

    expect(encodeWhereClause(`COALESCE(userId, $1) = $2`, encode))
      .toBe(`COALESCE(user_id, $1) = $2`)
  })

  it(`should handle complex expressions`, () => {
    expect(
      encodeWhereClause(
        `userId = $1 AND (projectId IS NULL OR projectId = $2)`,
        encode
      )
    ).toBe(`user_id = $1 AND (project_id IS NULL OR project_id = $2)`)
  })

  it(`should handle ORDER BY clauses`, () => {
    expect(encodeWhereClause(`createdAt ASC`, encode))
      .toBe(`created_at ASC`)

    expect(encodeWhereClause(`userId DESC, createdAt ASC`, encode))
      .toBe(`user_id DESC, created_at ASC`)
  })

  it(`should not transform parameter placeholders`, () => {
    // Parameter placeholders ($1, $2, etc.) don't match identifier pattern
    expect(encodeWhereClause(`userId = $1`, encode))
      .toBe(`user_id = $1`)
  })

  it(`should handle qualified column names`, () => {
    // Note: This will transform both table and column names
    // For table.column, both parts get transformed
    expect(encodeWhereClause(`todos.userId = $1`, encode))
      .toBe(`todos.user_id = $1`)
  })

  it(`should handle BETWEEN operator`, () => {
    expect(encodeWhereClause(`createdAt BETWEEN $1 AND $2`, encode))
      .toBe(`created_at BETWEEN $1 AND $2`)
  })

  it(`should handle CASE expressions`, () => {
    expect(
      encodeWhereClause(
        `CASE WHEN userId = $1 THEN projectId ELSE $2 END`,
        encode
      )
    ).toBe(`CASE WHEN user_id = $1 THEN project_id ELSE $2 END`)
  })

  it(`should preserve boolean literals`, () => {
    expect(encodeWhereClause(`isActive = TRUE AND isDeleted = FALSE`, encode))
      .toBe(`is_active = TRUE AND is_deleted = FALSE`)
  })

  it(`should not break on empty strings`, () => {
    expect(encodeWhereClause(``, encode)).toBe(``)
  })

  it(`should handle mixed case SQL keywords`, () => {
    expect(encodeWhereClause(`userId is null`, encode))
      .toBe(`user_id is null`)

    expect(encodeWhereClause(`userName like $1`, encode))
      .toBe(`user_name like $1`)
  })
})
