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

  it(`should preserve leading underscores`, () => {
    expect(snakeToCamel(`_user`)).toBe(`_user`)
    expect(snakeToCamel(`_user_id`)).toBe(`_userId`)
    expect(snakeToCamel(`__private`)).toBe(`__private`)
  })

  it(`should preserve trailing underscores`, () => {
    expect(snakeToCamel(`user_`)).toBe(`user_`)
    expect(snakeToCamel(`user_id_`)).toBe(`userId_`)
    expect(snakeToCamel(`user_id__`)).toBe(`userId__`)
  })

  it(`should collapse multiple consecutive underscores`, () => {
    expect(snakeToCamel(`user__id`)).toBe(`userId`)
    expect(snakeToCamel(`user___id`)).toBe(`userId`)
  })

  it(`should normalize mixed case to lowercase`, () => {
    expect(snakeToCamel(`user_Column`)).toBe(`userColumn`)
    expect(snakeToCamel(`User_ID`)).toBe(`userId`)
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

  it(`should handle acronyms properly`, () => {
    expect(camelToSnake(`userID`)).toBe(`user_id`)
    expect(camelToSnake(`userHTTPSUrl`)).toBe(`user_https_url`) // lowercase 'l' indicates boundary
    expect(camelToSnake(`parseHTMLString`)).toBe(`parse_html_string`)
    expect(camelToSnake(`XMLHttpRequest`)).toBe(`xml_http_request`)
  })

  it(`should handle acronyms with boundaries`, () => {
    // When there's a lowercase letter after an acronym, it indicates the boundary
    expect(camelToSnake(`HTTPSConnection`)).toBe(`https_connection`)
    expect(camelToSnake(`parseXMLDocument`)).toBe(`parse_xml_document`)
  })

  it(`should handle all-uppercase sequences as single word`, () => {
    // Without lowercase boundaries, all-uppercase is treated as one unit
    // This is expected behavior - the function can't know where acronyms split
    expect(camelToSnake(`userHTTPSURL`)).toBe(`user_httpsurl`)
    expect(camelToSnake(`getHTTPURL`)).toBe(`get_httpurl`)
  })

  it(`should handle mixed patterns`, () => {
    expect(camelToSnake(`userProfileImageURL`)).toBe(`user_profile_image_url`)
  })
})

describe(`roundtrip conversions`, () => {
  it(`should roundtrip snake_case -> camelCase -> snake_case for typical cases`, () => {
    const testCases = [
      `user_id`,
      `project_id`,
      `created_at`,
      `user_profile_image_url`,
    ]

    for (const original of testCases) {
      const camelCase = snakeToCamel(original)
      const backToSnake = camelToSnake(camelCase)
      expect(backToSnake).toBe(original)
    }
  })

  it(`should roundtrip with trailing underscores`, () => {
    const testCases = [`user_id_`, `metric__`, `data_point_value_`]

    for (const original of testCases) {
      const camelCase = snakeToCamel(original)
      const backToSnake = camelToSnake(camelCase)
      expect(backToSnake).toBe(original)
    }
  })

  it(`should document known roundtrip limitation for single-letter segments`, () => {
    // Single-letter segments become consecutive uppercase letters in camelCase
    // which then merge when converting back to snake_case
    // This is expected behavior and a known limitation
    expect(snakeToCamel(`a_b_c`)).toBe(`aBC`)
    expect(camelToSnake(`aBC`)).toBe(`a_bc`) // Lost the middle underscore
  })

  // Note: camelCase -> snake_case -> camelCase doesn't always roundtrip
  // because acronyms are ambiguous (userID -> user_id -> userId)
  // This is expected behavior
})

describe(`createColumnMapper`, () => {
  it(`should create a mapper with explicit column mapping`, () => {
    const mapper = createColumnMapper({
      user_id: `userId`,
      project_id: `projectId`,
      created_at: `createdAt`,
    })

    expect(
      mapper.decode({ user_id: 1, project_id: 2, created_at: `2025-01-01` })
    ).toEqual({ userId: 1, projectId: 2, createdAt: `2025-01-01` })

    expect(mapper.encode(`userId`)).toBe(`user_id`)
    expect(mapper.encode(`projectId`)).toBe(`project_id`)
    expect(mapper.encode(`createdAt`)).toBe(`created_at`)
  })

  it(`should pass through unmapped columns`, () => {
    const mapper = createColumnMapper({
      user_id: `userId`,
    })

    expect(mapper.decode({ user_id: 1, name: `John`, age: 30 })).toEqual({
      userId: 1,
      name: `John`,
      age: 30,
    })
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

    expect(mapper.decode({ user_id: 1, project_id: 2 })).toEqual({
      userId: 1,
      projectId: 2,
    })

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

    expect(
      mapper.decode({ user_id: 1, project_id: 2, created_at: `2025-01-01` })
    ).toEqual({ userId: 1, projectId: 2, createdAt: `2025-01-01` })

    expect(mapper.encode(`userId`)).toBe(`user_id`)
    expect(mapper.encode(`projectId`)).toBe(`project_id`)
    expect(mapper.encode(`createdAt`)).toBe(`created_at`)
  })
})

describe(`encodeWhereClause`, () => {
  const encode = (col: string) => camelToSnake(col)

  it(`should return empty string when whereClause is undefined`, () => {
    expect(encodeWhereClause(undefined, encode)).toBe(``)
  })

  it(`should return whereClause unchanged when encoder is undefined`, () => {
    expect(encodeWhereClause(`userId = $1`, undefined)).toBe(`userId = $1`)
  })

  it(`should encode simple WHERE clauses`, () => {
    expect(encodeWhereClause(`userId = $1`, encode)).toBe(`user_id = $1`)

    expect(encodeWhereClause(`projectId = $1 AND userId = $2`, encode)).toBe(
      `project_id = $1 AND user_id = $2`
    )
  })

  it(`should not encode SQL keywords`, () => {
    expect(encodeWhereClause(`userId IS NULL`, encode)).toBe(`user_id IS NULL`)

    expect(encodeWhereClause(`userId IN ($1, $2)`, encode)).toBe(
      `user_id IN ($1, $2)`
    )

    expect(encodeWhereClause(`userId LIKE $1`, encode)).toBe(`user_id LIKE $1`)
  })

  it(`should handle function calls`, () => {
    expect(encodeWhereClause(`LOWER(userName) = $1`, encode)).toBe(
      `LOWER(user_name) = $1`
    )

    expect(encodeWhereClause(`COALESCE(userId, $1) = $2`, encode)).toBe(
      `COALESCE(user_id, $1) = $2`
    )
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
    expect(encodeWhereClause(`createdAt ASC`, encode)).toBe(`created_at ASC`)

    expect(encodeWhereClause(`userId DESC, createdAt ASC`, encode)).toBe(
      `user_id DESC, created_at ASC`
    )
  })

  it(`should not transform parameter placeholders`, () => {
    // Parameter placeholders ($1, $2, etc.) don't match identifier pattern
    expect(encodeWhereClause(`userId = $1`, encode)).toBe(`user_id = $1`)
  })

  it(`should handle qualified column names`, () => {
    // Note: This will transform both table and column names
    // For table.column, both parts get transformed
    expect(encodeWhereClause(`todos.userId = $1`, encode)).toBe(
      `todos.user_id = $1`
    )
  })

  it(`should handle BETWEEN operator`, () => {
    expect(encodeWhereClause(`createdAt BETWEEN $1 AND $2`, encode)).toBe(
      `created_at BETWEEN $1 AND $2`
    )
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
    expect(
      encodeWhereClause(`isActive = TRUE AND isDeleted = FALSE`, encode)
    ).toBe(`is_active = TRUE AND is_deleted = FALSE`)
  })

  it(`should not break on empty strings`, () => {
    expect(encodeWhereClause(``, encode)).toBe(``)
  })

  it(`should handle mixed case SQL keywords`, () => {
    expect(encodeWhereClause(`userId is null`, encode)).toBe(`user_id is null`)

    expect(encodeWhereClause(`userName like $1`, encode)).toBe(
      `user_name like $1`
    )
  })

  it(`should not transform quoted string literals`, () => {
    expect(encodeWhereClause(`userId = 'user_id'`, encode)).toBe(
      `user_id = 'user_id'`
    )

    expect(encodeWhereClause(`name = 'John Doe' AND userId = $1`, encode)).toBe(
      `name = 'John Doe' AND user_id = $1`
    )
  })

  it(`should handle escaped quotes in strings`, () => {
    expect(encodeWhereClause(`name = 'O''Brien' AND userId = $1`, encode)).toBe(
      `name = 'O''Brien' AND user_id = $1`
    )
  })

  it(`should handle multiple quoted strings`, () => {
    expect(
      encodeWhereClause(
        `firstName = 'John' AND lastName = 'Doe' AND userId = $1`,
        encode
      )
    ).toBe(`first_name = 'John' AND last_name = 'Doe' AND user_id = $1`)
  })

  it(`should not transform double-quoted identifiers`, () => {
    // Postgres uses double quotes for case-sensitive identifiers
    expect(encodeWhereClause(`"userId" = $1`, encode)).toBe(`"userId" = $1`)

    expect(encodeWhereClause(`"User"."createdAt" = $1`, encode)).toBe(
      `"User"."createdAt" = $1`
    )
  })

  it(`should handle escaped double quotes in identifiers`, () => {
    // Postgres uses "" to escape double quotes in identifiers
    expect(encodeWhereClause(`"column""name" = $1`, encode)).toBe(
      `"column""name" = $1`
    )
  })

  it(`should handle mixed quoted and unquoted identifiers`, () => {
    expect(
      encodeWhereClause(`userId = $1 AND "CaseSensitive" = $2`, encode)
    ).toBe(`user_id = $1 AND "CaseSensitive" = $2`)
  })
})

describe(`columnMapper and transformer together`, () => {
  it(`should chain columnMapper.decode and transformer`, () => {
    const mapper = createColumnMapper({
      user_id: `userId`,
      created_at: `createdAt`,
    })

    // Simulating what ShapeStream does
    type TestRow = { userId?: string; createdAt?: string | Date }
    const transformer = (row: TestRow) => ({
      ...row,
      // Transform the value (after column rename)
      createdAt: new Date(row.createdAt as string),
    })

    // Chained: columnMapper first, then transformer
    const chained = (row: Record<string, string>) =>
      transformer(mapper.decode(row) as TestRow)

    const result = chained({
      user_id: `123`,
      created_at: `2025-01-17T00:00:00Z`,
    })

    expect(result).toEqual({
      userId: `123`, // Column renamed by mapper
      createdAt: new Date(`2025-01-17T00:00:00Z`), // Value transformed by transformer
    })
  })
})
