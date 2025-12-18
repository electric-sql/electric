import { describe, expect, it } from 'vitest'
import { compileExpression, compileOrderBy } from '../src/expression-compiler'
import { camelToSnake } from '../src/column-mapper'
import type {
  SerializedExpression,
  SerializedOrderByClause,
} from '../src/types'

describe(`compileExpression`, () => {
  describe(`column references`, () => {
    it(`should compile column reference without mapper`, () => {
      const expr: SerializedExpression = { type: `ref`, column: `userId` }
      expect(compileExpression(expr)).toBe(`"userId"`)
    })

    it(`should compile column reference with mapper`, () => {
      const expr: SerializedExpression = { type: `ref`, column: `userId` }
      expect(compileExpression(expr, camelToSnake)).toBe(`"user_id"`)
    })

    it(`should quote identifiers with special characters`, () => {
      const expr: SerializedExpression = { type: `ref`, column: `has"quote` }
      expect(compileExpression(expr)).toBe(`"has""quote"`)
    })
  })

  describe(`parameter placeholders`, () => {
    it(`should compile parameter placeholder`, () => {
      const expr: SerializedExpression = { type: `val`, paramIndex: 1 }
      expect(compileExpression(expr)).toBe(`$1`)
    })

    it(`should compile multiple parameter indices`, () => {
      expect(
        compileExpression({ type: `val`, paramIndex: 2 })
      ).toBe(`$2`)
      expect(
        compileExpression({ type: `val`, paramIndex: 10 })
      ).toBe(`$10`)
    })
  })

  describe(`binary comparison operators`, () => {
    it(`should compile eq (=) operator`, () => {
      const expr: SerializedExpression = {
        type: `func`,
        name: `eq`,
        args: [
          { type: `ref`, column: `userId` },
          { type: `val`, paramIndex: 1 },
        ],
      }
      expect(compileExpression(expr)).toBe(`"userId" = $1`)
    })

    it(`should compile eq with columnMapper`, () => {
      const expr: SerializedExpression = {
        type: `func`,
        name: `eq`,
        args: [
          { type: `ref`, column: `userId` },
          { type: `val`, paramIndex: 1 },
        ],
      }
      expect(compileExpression(expr, camelToSnake)).toBe(`"user_id" = $1`)
    })

    it(`should compile gt (>) operator`, () => {
      const expr: SerializedExpression = {
        type: `func`,
        name: `gt`,
        args: [
          { type: `ref`, column: `age` },
          { type: `val`, paramIndex: 1 },
        ],
      }
      expect(compileExpression(expr)).toBe(`"age" > $1`)
    })

    it(`should compile gte (>=) operator`, () => {
      const expr: SerializedExpression = {
        type: `func`,
        name: `gte`,
        args: [
          { type: `ref`, column: `age` },
          { type: `val`, paramIndex: 1 },
        ],
      }
      expect(compileExpression(expr)).toBe(`"age" >= $1`)
    })

    it(`should compile lt (<) operator`, () => {
      const expr: SerializedExpression = {
        type: `func`,
        name: `lt`,
        args: [
          { type: `ref`, column: `price` },
          { type: `val`, paramIndex: 1 },
        ],
      }
      expect(compileExpression(expr)).toBe(`"price" < $1`)
    })

    it(`should compile lte (<=) operator`, () => {
      const expr: SerializedExpression = {
        type: `func`,
        name: `lte`,
        args: [
          { type: `ref`, column: `price` },
          { type: `val`, paramIndex: 1 },
        ],
      }
      expect(compileExpression(expr)).toBe(`"price" <= $1`)
    })
  })

  describe(`logical operators`, () => {
    it(`should compile and operator`, () => {
      const expr: SerializedExpression = {
        type: `func`,
        name: `and`,
        args: [
          {
            type: `func`,
            name: `eq`,
            args: [
              { type: `ref`, column: `userId` },
              { type: `val`, paramIndex: 1 },
            ],
          },
          {
            type: `func`,
            name: `eq`,
            args: [
              { type: `ref`, column: `isActive` },
              { type: `val`, paramIndex: 2 },
            ],
          },
        ],
      }
      expect(compileExpression(expr)).toBe(
        `("userId" = $1) AND ("isActive" = $2)`
      )
    })

    it(`should compile and with columnMapper`, () => {
      const expr: SerializedExpression = {
        type: `func`,
        name: `and`,
        args: [
          {
            type: `func`,
            name: `eq`,
            args: [
              { type: `ref`, column: `userId` },
              { type: `val`, paramIndex: 1 },
            ],
          },
          {
            type: `func`,
            name: `eq`,
            args: [
              { type: `ref`, column: `isActive` },
              { type: `val`, paramIndex: 2 },
            ],
          },
        ],
      }
      expect(compileExpression(expr, camelToSnake)).toBe(
        `("user_id" = $1) AND ("is_active" = $2)`
      )
    })

    it(`should compile or operator`, () => {
      const expr: SerializedExpression = {
        type: `func`,
        name: `or`,
        args: [
          {
            type: `func`,
            name: `eq`,
            args: [
              { type: `ref`, column: `status` },
              { type: `val`, paramIndex: 1 },
            ],
          },
          {
            type: `func`,
            name: `eq`,
            args: [
              { type: `ref`, column: `status` },
              { type: `val`, paramIndex: 2 },
            ],
          },
        ],
      }
      expect(compileExpression(expr)).toBe(
        `("status" = $1) OR ("status" = $2)`
      )
    })

    it(`should compile not operator`, () => {
      const expr: SerializedExpression = {
        type: `func`,
        name: `not`,
        args: [
          {
            type: `func`,
            name: `eq`,
            args: [
              { type: `ref`, column: `deleted` },
              { type: `val`, paramIndex: 1 },
            ],
          },
        ],
      }
      expect(compileExpression(expr)).toBe(`NOT ("deleted" = $1)`)
    })
  })

  describe(`special operators`, () => {
    it(`should compile in operator`, () => {
      const expr: SerializedExpression = {
        type: `func`,
        name: `in`,
        args: [
          { type: `ref`, column: `id` },
          { type: `val`, paramIndex: 1 },
        ],
      }
      expect(compileExpression(expr)).toBe(`"id" = ANY($1)`)
    })

    it(`should compile like operator`, () => {
      const expr: SerializedExpression = {
        type: `func`,
        name: `like`,
        args: [
          { type: `ref`, column: `name` },
          { type: `val`, paramIndex: 1 },
        ],
      }
      expect(compileExpression(expr)).toBe(`"name" LIKE $1`)
    })

    it(`should compile ilike operator`, () => {
      const expr: SerializedExpression = {
        type: `func`,
        name: `ilike`,
        args: [
          { type: `ref`, column: `email` },
          { type: `val`, paramIndex: 1 },
        ],
      }
      expect(compileExpression(expr)).toBe(`"email" ILIKE $1`)
    })

    it(`should compile isNull operator`, () => {
      const expr: SerializedExpression = {
        type: `func`,
        name: `isNull`,
        args: [{ type: `ref`, column: `deletedAt` }],
      }
      expect(compileExpression(expr)).toBe(`"deletedAt" IS NULL`)
    })

    it(`should compile isUndefined as IS NULL`, () => {
      const expr: SerializedExpression = {
        type: `func`,
        name: `isUndefined`,
        args: [{ type: `ref`, column: `optionalField` }],
      }
      expect(compileExpression(expr)).toBe(`"optionalField" IS NULL`)
    })
  })

  describe(`string functions`, () => {
    it(`should compile upper function`, () => {
      const expr: SerializedExpression = {
        type: `func`,
        name: `upper`,
        args: [{ type: `ref`, column: `name` }],
      }
      expect(compileExpression(expr)).toBe(`UPPER("name")`)
    })

    it(`should compile lower function`, () => {
      const expr: SerializedExpression = {
        type: `func`,
        name: `lower`,
        args: [{ type: `ref`, column: `email` }],
      }
      expect(compileExpression(expr)).toBe(`LOWER("email")`)
    })

    it(`should compile length function`, () => {
      const expr: SerializedExpression = {
        type: `func`,
        name: `length`,
        args: [{ type: `ref`, column: `title` }],
      }
      expect(compileExpression(expr)).toBe(`LENGTH("title")`)
    })

    it(`should compile concat function`, () => {
      const expr: SerializedExpression = {
        type: `func`,
        name: `concat`,
        args: [
          { type: `ref`, column: `firstName` },
          { type: `ref`, column: `lastName` },
        ],
      }
      expect(compileExpression(expr)).toBe(`CONCAT("firstName", "lastName")`)
    })

    it(`should compile concat with columnMapper`, () => {
      const expr: SerializedExpression = {
        type: `func`,
        name: `concat`,
        args: [
          { type: `ref`, column: `firstName` },
          { type: `ref`, column: `lastName` },
        ],
      }
      expect(compileExpression(expr, camelToSnake)).toBe(
        `CONCAT("first_name", "last_name")`
      )
    })
  })

  describe(`other functions`, () => {
    it(`should compile coalesce function`, () => {
      const expr: SerializedExpression = {
        type: `func`,
        name: `coalesce`,
        args: [
          { type: `ref`, column: `nickname` },
          { type: `ref`, column: `name` },
        ],
      }
      expect(compileExpression(expr)).toBe(`COALESCE("nickname", "name")`)
    })

    it(`should compile coalesce with multiple arguments`, () => {
      const expr: SerializedExpression = {
        type: `func`,
        name: `coalesce`,
        args: [
          { type: `ref`, column: `nickname` },
          { type: `ref`, column: `firstName` },
          { type: `val`, paramIndex: 1 },
        ],
      }
      expect(compileExpression(expr)).toBe(
        `COALESCE("nickname", "firstName", $1)`
      )
    })
  })

  describe(`complex expressions`, () => {
    it(`should compile nested expressions`, () => {
      // (userId = $1 AND isActive = $2) OR (role = $3)
      const expr: SerializedExpression = {
        type: `func`,
        name: `or`,
        args: [
          {
            type: `func`,
            name: `and`,
            args: [
              {
                type: `func`,
                name: `eq`,
                args: [
                  { type: `ref`, column: `userId` },
                  { type: `val`, paramIndex: 1 },
                ],
              },
              {
                type: `func`,
                name: `eq`,
                args: [
                  { type: `ref`, column: `isActive` },
                  { type: `val`, paramIndex: 2 },
                ],
              },
            ],
          },
          {
            type: `func`,
            name: `eq`,
            args: [
              { type: `ref`, column: `role` },
              { type: `val`, paramIndex: 3 },
            ],
          },
        ],
      }
      expect(compileExpression(expr)).toBe(
        `(("userId" = $1) AND ("isActive" = $2)) OR ("role" = $3)`
      )
    })

    it(`should compile deeply nested expressions with columnMapper`, () => {
      const expr: SerializedExpression = {
        type: `func`,
        name: `and`,
        args: [
          {
            type: `func`,
            name: `eq`,
            args: [
              { type: `ref`, column: `userId` },
              { type: `val`, paramIndex: 1 },
            ],
          },
          {
            type: `func`,
            name: `or`,
            args: [
              {
                type: `func`,
                name: `isNull`,
                args: [{ type: `ref`, column: `deletedAt` }],
              },
              {
                type: `func`,
                name: `gte`,
                args: [
                  { type: `ref`, column: `deletedAt` },
                  { type: `val`, paramIndex: 2 },
                ],
              },
            ],
          },
        ],
      }
      expect(compileExpression(expr, camelToSnake)).toBe(
        `("user_id" = $1) AND (("deleted_at" IS NULL) OR ("deleted_at" >= $2))`
      )
    })
  })

  describe(`error handling`, () => {
    it(`should throw for unknown function`, () => {
      const expr: SerializedExpression = {
        type: `func`,
        name: `unknownFunc`,
        args: [],
      }
      expect(() => compileExpression(expr)).toThrow(`Unknown function: unknownFunc`)
    })
  })
})

describe(`compileOrderBy`, () => {
  it(`should compile single column ascending (default)`, () => {
    const clauses: SerializedOrderByClause[] = [{ column: `createdAt` }]
    expect(compileOrderBy(clauses)).toBe(`"createdAt"`)
  })

  it(`should compile single column descending`, () => {
    const clauses: SerializedOrderByClause[] = [
      { column: `createdAt`, direction: `desc` },
    ]
    expect(compileOrderBy(clauses)).toBe(`"createdAt" DESC`)
  })

  it(`should compile with NULLS FIRST`, () => {
    const clauses: SerializedOrderByClause[] = [
      { column: `createdAt`, direction: `desc`, nulls: `first` },
    ]
    expect(compileOrderBy(clauses)).toBe(`"createdAt" DESC NULLS FIRST`)
  })

  it(`should compile with NULLS LAST`, () => {
    const clauses: SerializedOrderByClause[] = [
      { column: `createdAt`, direction: `asc`, nulls: `last` },
    ]
    expect(compileOrderBy(clauses)).toBe(`"createdAt" NULLS LAST`)
  })

  it(`should compile multiple columns`, () => {
    const clauses: SerializedOrderByClause[] = [
      { column: `userId`, direction: `asc` },
      { column: `createdAt`, direction: `desc`, nulls: `first` },
    ]
    expect(compileOrderBy(clauses)).toBe(
      `"userId", "createdAt" DESC NULLS FIRST`
    )
  })

  it(`should apply columnMapper`, () => {
    const clauses: SerializedOrderByClause[] = [
      { column: `createdAt`, direction: `desc`, nulls: `first` },
    ]
    expect(compileOrderBy(clauses, camelToSnake)).toBe(
      `"created_at" DESC NULLS FIRST`
    )
  })

  it(`should apply columnMapper to multiple columns`, () => {
    const clauses: SerializedOrderByClause[] = [
      { column: `userId` },
      { column: `createdAt`, direction: `desc` },
      { column: `isActive`, direction: `asc`, nulls: `last` },
    ]
    expect(compileOrderBy(clauses, camelToSnake)).toBe(
      `"user_id", "created_at" DESC, "is_active" NULLS LAST`
    )
  })

  it(`should handle empty clause array`, () => {
    expect(compileOrderBy([])).toBe(``)
  })
})

describe(`integration with columnMapper`, () => {
  it(`should properly transform column names for typical TanStack DB request`, () => {
    // Simulating the example from the tutorial
    const whereExpr: SerializedExpression = {
      type: `func`,
      name: `and`,
      args: [
        {
          type: `func`,
          name: `eq`,
          args: [
            { type: `ref`, column: `userId` },
            { type: `val`, paramIndex: 1 },
          ],
        },
        {
          type: `func`,
          name: `eq`,
          args: [
            { type: `ref`, column: `isActive` },
            { type: `val`, paramIndex: 2 },
          ],
        },
      ],
    }

    const orderByExpr: SerializedOrderByClause[] = [
      { column: `createdAt`, direction: `desc`, nulls: `first` },
    ]

    expect(compileExpression(whereExpr, camelToSnake)).toBe(
      `("user_id" = $1) AND ("is_active" = $2)`
    )
    expect(compileOrderBy(orderByExpr, camelToSnake)).toBe(
      `"created_at" DESC NULLS FIRST`
    )
  })
})
