import anyTest, { TestFn } from 'ava'
import { Builder } from '../../../src/client/model/builder'
import { ZodError } from 'zod'
import { Dialect } from '../../../src/migrators/query-builder/builder'
import { ShapeManagerMock } from '../../../src/client/model/shapes'
import { schema } from '../generated'
import { pgBuilder, sqliteBuilder } from '../../../src/migrators/query-builder'

export type ContextType = {
  tbl: Builder
}

const post1 = {
  id: 'i1',
  title: 't1',
  contents: 'c1',
  nbr: 18,
}

const post2 = {
  id: 'i2',
  title: 't2',
  contents: 'c2',
  nbr: 21,
}

const test = anyTest as TestFn<ContextType>

const shapeManager = new ShapeManagerMock()
const postTableDescription = schema.getTableDescription('Post')
// Sync all shapes such that we don't get warnings on every query
shapeManager.sync({ tablename: 'Post' })

function makeContext(dialect: Dialect) {
  test.beforeEach(async (t) => {
    const tbl = new Builder(
      'Post',
      ['id', 'title', 'contents', 'nbr'],
      shapeManager,
      postTableDescription,
      dialect
    )

    t.context = { tbl }
  })
}

/*
 * The tests below check that the generated queries are correct.
 * The query builder does not validate the input, it assumes that the input it gets was already validated.
 * Input validation is currently done by the `Table` itself before building the query.
 */

export const builderTests = (dialect: Dialect) => {
  makeContext(dialect)
  const builder = dialect === 'SQLite' ? sqliteBuilder : pgBuilder
  const makePositionalParam = builder.makePositionalParam.bind(builder)

  test('null values are inserted as NULL', (t) => {
    const { tbl } = t.context
    const stmt = tbl
      .create({
        data: {
          id: 'i1',
          title: 't1',
          contents: 'c1',
          nbr: null,
        },
      })
      .toParam()

    t.deepEqual(stmt, {
      text: `INSERT INTO "Post" ("id", "title", "contents", "nbr") VALUES (${makePositionalParam(
        1
      )}, ${makePositionalParam(2)}, ${makePositionalParam(
        3
      )}, ${makePositionalParam(
        4
      )}) RETURNING "id", "title", "contents", "nbr"`,
      values: ['i1', 't1', 'c1', null],
    })
  })

  // Test that we can make a create query
  test('create query', (t) => {
    const { tbl } = t.context
    const stmt = tbl
      .create({
        data: post1,
      })
      .toParam()

    t.deepEqual(stmt, {
      text: `INSERT INTO "Post" ("id", "title", "contents", "nbr") VALUES (${makePositionalParam(
        1
      )}, ${makePositionalParam(2)}, ${makePositionalParam(
        3
      )}, ${makePositionalParam(
        4
      )}) RETURNING "id", "title", "contents", "nbr"`,
      values: ['i1', 't1', 'c1', 18],
    })
  })

  test('createMany query', (t) => {
    const { tbl } = t.context
    const stmt1 = tbl
      .createMany({
        data: [post1, post2],
      })
      .toParam()

    t.deepEqual(stmt1, {
      text: `INSERT INTO "Post" ("id", "title", "contents", "nbr") VALUES (${makePositionalParam(
        1
      )}, ${makePositionalParam(2)}, ${makePositionalParam(
        3
      )}, ${makePositionalParam(4)}), (${makePositionalParam(
        5
      )}, ${makePositionalParam(6)}, ${makePositionalParam(
        7
      )}, ${makePositionalParam(8)})`,
      values: ['i1', 't1', 'c1', 18, 'i2', 't2', 'c2', 21],
    })

    const stmt2 = tbl
      .createMany({
        data: [post1, post2],
        skipDuplicates: true,
      })
      .toParam()

    t.deepEqual(stmt2, {
      text: `INSERT INTO "Post" ("id", "title", "contents", "nbr") VALUES (${makePositionalParam(
        1
      )}, ${makePositionalParam(2)}, ${makePositionalParam(
        3
      )}, ${makePositionalParam(4)}), (${makePositionalParam(
        5
      )}, ${makePositionalParam(6)}, ${makePositionalParam(
        7
      )}, ${makePositionalParam(8)}) ON CONFLICT DO NOTHING`,
      values: ['i1', 't1', 'c1', 18, 'i2', 't2', 'c2', 21],
    })
  })

  test('findUnique query', async (t) => {
    const { tbl } = t.context
    const stmt = tbl
      .findUnique({
        where: {
          id: 'i2',
          nbr: 21,
        },
      })
      .toParam()

    t.deepEqual(stmt, {
      text: `SELECT "id", "nbr", "title", "contents" FROM "Post" WHERE ("id" = ${makePositionalParam(
        1
      )}) AND ("nbr" = ${makePositionalParam(2)}) LIMIT ${makePositionalParam(
        3
      )}`,
      values: ['i2', 21, 2],
    })
  })

  test('findUnique query with selection', (t) => {
    const { tbl } = t.context
    const stmt = tbl
      .findUnique({
        where: {
          id: 'i2',
          nbr: 21,
        },
        select: {
          title: true,
          contents: false,
        },
      })
      .toParam()

    t.deepEqual(stmt, {
      text: `SELECT "id", "nbr", "title" FROM "Post" WHERE ("id" = ${makePositionalParam(
        1
      )}) AND ("nbr" = ${makePositionalParam(2)}) LIMIT ${makePositionalParam(
        3
      )}`,
      values: ['i2', 21, 2],
    })
  })

  test('findUnique query with selection of NULL value', (t) => {
    const { tbl } = t.context
    const stmt = tbl
      .findUnique({
        where: {
          id: 'i2',
          nbr: null,
        },
        select: {
          title: true,
          contents: false,
        },
      })
      .toParam()

    t.deepEqual(stmt, {
      text: `SELECT "id", "nbr", "title" FROM "Post" WHERE ("id" = ${makePositionalParam(
        1
      )}) AND ("nbr" IS NULL) LIMIT ${makePositionalParam(2)}`,
      values: ['i2', 2],
    })
  })

  test('findUnique query with selection of non-NULL value', (t) => {
    const { tbl } = t.context
    const stmt = tbl
      .findUnique({
        where: {
          id: 'i2',
          nbr: { not: null },
        },
        select: {
          title: true,
          contents: false,
        },
      })
      .toParam()

    t.deepEqual(stmt, {
      text: `SELECT "id", "nbr", "title" FROM "Post" WHERE ("id" = ${makePositionalParam(
        1
      )}) AND ("nbr" IS NOT NULL) LIMIT ${makePositionalParam(2)}`,
      values: ['i2', 2],
    })
  })

  test('findUnique query with selection of row that does not equal a value', (t) => {
    const { tbl } = t.context
    const stmt = tbl
      .findUnique({
        where: {
          id: 'i2',
          nbr: { not: 5 },
        },
        select: {
          title: true,
          contents: false,
        },
      })
      .toParam()

    t.deepEqual(stmt, {
      text: `SELECT "id", "nbr", "title" FROM "Post" WHERE ("id" = ${makePositionalParam(
        1
      )}) AND ("nbr" != ${makePositionalParam(2)}) LIMIT ${makePositionalParam(
        3
      )}`,
      values: ['i2', 5, 2],
    })
  })

  test('findUnique query supports several filters', (t) => {
    const { tbl } = t.context
    const stmt = tbl
      .findUnique({
        where: {
          id: 'i2',
          nbr: { not: 5, in: [1, 2, 3] },
        },
      })
      .toParam()

    t.deepEqual(stmt, {
      text: `SELECT "id", "nbr", "title", "contents" FROM "Post" WHERE ("id" = ${makePositionalParam(
        1
      )}) AND ("nbr" IN (${makePositionalParam(2)}, ${makePositionalParam(
        3
      )}, ${makePositionalParam(4)})) AND ("nbr" != ${makePositionalParam(
        5
      )}) LIMIT ${makePositionalParam(6)}`,
      values: ['i2', 1, 2, 3, 5, 2],
    })
  })

  test('findUnique query with no filters throws an error', (t) => {
    const { tbl } = t.context
    const error = t.throws(
      () => {
        tbl.findUnique({
          where: {
            id: 'i2',
            nbr: 21,
            foo: {},
          },
        })
      },
      { instanceOf: ZodError }
    )

    t.deepEqual((error as ZodError).issues, [
      {
        code: 'custom',
        message: 'Please provide at least one filter.',
        path: [],
      },
    ])
  })

  test('findMany allows results to be ordered on one field', (t) => {
    const { tbl } = t.context
    const stmt = tbl
      .findMany({
        // `where` argument must not be provided when using the actual API because it is added as default by the validator
        // but since we directly use the query builder we need to provide it
        where: {},
        orderBy: {
          id: 'asc',
        },
      })
      .toParam()

    t.deepEqual(stmt, {
      text: `SELECT "id", "title", "contents", "nbr" FROM "Post" ORDER BY "id" ASC`,
      values: [],
    })
  })

  test('findMany allows results to be ordered on several fields', (t) => {
    const { tbl } = t.context
    const stmt = tbl
      .findMany({
        // `where` argument must not be provided when using the actual API because it is added as default by the validator
        // but since we directly use the query builder we need to provide it
        where: {},
        orderBy: [
          {
            id: 'asc',
          },
          {
            title: 'desc',
          },
        ],
      })
      .toParam()

    t.deepEqual(stmt, {
      text: `SELECT "id", "title", "contents", "nbr" FROM "Post" ORDER BY "id" ASC, "title" DESC`,
      values: [],
    })
  })

  test('findMany supports pagination', (t) => {
    const { tbl } = t.context
    const stmt = tbl
      .findMany({
        // `where` argument must not be provided when using the actual API because it is added as default by the validator
        // but since we directly use the query builder we need to provide it
        where: {},
        take: 1,
        skip: 1,
      })
      .toParam()

    t.deepEqual(stmt, {
      text: `SELECT "id", "title", "contents", "nbr" FROM "Post" LIMIT ${makePositionalParam(
        1
      )} OFFSET ${makePositionalParam(2)}`,
      values: [1, 1],
    })
  })

  test('findMany supports distinct results', (t) => {
    const { tbl } = t.context
    const stmt = tbl
      .findMany({
        // `where` argument must not be provided when using the actual API because it is added as default by the validator
        // but since we directly use the query builder we need to provide it
        where: {},
        distinct: ['nbr'],
      })
      .toParam()

    t.deepEqual(stmt, {
      text: `SELECT DISTINCT ON ("nbr") "id", "title", "contents", "nbr" FROM "Post"`,
      values: [],
    })
  })

  test('findMany supports IN filters in where argument', (t) => {
    const { tbl } = t.context
    const stmt = tbl
      .findMany({
        where: {
          nbr: {
            in: [1, 5, 18],
          },
        },
      })
      .toParam()

    t.deepEqual(stmt, {
      text: `SELECT "nbr", "id", "title", "contents" FROM "Post" WHERE ("nbr" IN (${makePositionalParam(
        1
      )}, ${makePositionalParam(2)}, ${makePositionalParam(3)}))`,
      values: [1, 5, 18],
    })
  })

  test('findMany supports NOT IN filters in where argument', (t) => {
    const { tbl } = t.context
    const stmt = tbl
      .findMany({
        where: {
          nbr: {
            notIn: [1, 5, 18],
          },
        },
      })
      .toParam()

    t.deepEqual(stmt, {
      text: `SELECT "nbr", "id", "title", "contents" FROM "Post" WHERE ("nbr" NOT IN (${makePositionalParam(
        1
      )}, ${makePositionalParam(2)}, ${makePositionalParam(3)}))`,
      values: [1, 5, 18],
    })
  })

  test('findMany supports lt, lte, gt, gte filters in where argument', (t) => {
    const { tbl } = t.context
    const stmt = tbl
      .findMany({
        where: {
          nbr: {
            lt: 11,
            lte: 10,
            gt: 4,
            gte: 5,
          },
        },
      })
      .toParam()

    t.deepEqual(stmt, {
      text: `SELECT "nbr", "id", "title", "contents" FROM "Post" WHERE ("nbr" < ${makePositionalParam(
        1
      )}) AND ("nbr" <= ${makePositionalParam(
        2
      )}) AND ("nbr" > ${makePositionalParam(
        3
      )}) AND ("nbr" >= ${makePositionalParam(4)})`,
      values: [11, 10, 4, 5],
    })
  })

  test('findMany supports startsWith filter in where argument', (t) => {
    const { tbl } = t.context
    const stmt = tbl
      .findMany({
        where: {
          title: {
            startsWith: 'foo',
          },
        },
      })
      .toParam()

    t.deepEqual(stmt, {
      text: `SELECT "title", "id", "contents", "nbr" FROM "Post" WHERE ("title" LIKE ${makePositionalParam(
        1
      )})`,
      values: ['foo%'],
    })
  })

  test('findMany supports endsWith filter in where argument', (t) => {
    const { tbl } = t.context
    const stmt = tbl
      .findMany({
        where: {
          title: {
            endsWith: 'foo',
          },
        },
      })
      .toParam()

    t.deepEqual(stmt, {
      text: `SELECT "title", "id", "contents", "nbr" FROM "Post" WHERE ("title" LIKE ${makePositionalParam(
        1
      )})`,
      values: ['%foo'],
    })
  })

  test('findMany supports contains filter in where argument', (t) => {
    const { tbl } = t.context
    const stmt = tbl
      .findMany({
        where: {
          title: {
            contains: 'foo',
          },
        },
      })
      .toParam()

    t.deepEqual(stmt, {
      text: `SELECT "title", "id", "contents", "nbr" FROM "Post" WHERE ("title" LIKE ${makePositionalParam(
        1
      )})`,
      values: ['%foo%'],
    })
  })

  test('findMany supports boolean filters in where argument', (t) => {
    const { tbl } = t.context
    const stmt = tbl
      .findMany({
        where: {
          OR: [
            {
              title: {
                contains: 'foo',
              },
            },
            {
              title: 'bar',
            },
          ],
          AND: [
            {
              contents: 'content',
            },
            {
              nbr: 6,
            },
          ],
          NOT: [
            {
              title: 'foobar',
            },
            {
              title: 'barfoo',
            },
          ],
          nbr: 5,
        },
      })
      .toParam()

    t.deepEqual(stmt, {
      text: `SELECT "nbr", "id", "title", "contents" FROM "Post" WHERE ("title" LIKE ${makePositionalParam(
        1
      )} OR "title" = ${makePositionalParam(
        2
      )}) AND ("contents" = ${makePositionalParam(
        3
      )} AND "nbr" = ${makePositionalParam(
        4
      )}) AND ((NOT "title" = ${makePositionalParam(
        5
      )}) AND (NOT "title" = ${makePositionalParam(
        6
      )})) AND ("nbr" = ${makePositionalParam(7)})`,
      values: ['%foo%', 'bar', 'content', 6, 'foobar', 'barfoo', 5],
    })
  })

  test('findMany supports single AND filter and single NOT filter in where argument', (t) => {
    const { tbl } = t.context
    const stmt = tbl
      .findMany({
        where: {
          OR: [
            {
              title: {
                contains: 'foo',
              },
            },
            {
              title: 'bar',
            },
          ],
          AND: {
            contents: 'content',
          },
          NOT: {
            title: 'foobar',
          },
          nbr: 5,
        },
      })
      .toParam()

    t.deepEqual(stmt, {
      text: `SELECT "nbr", "id", "title", "contents" FROM "Post" WHERE ("title" LIKE ${makePositionalParam(
        1
      )} OR "title" = ${makePositionalParam(
        2
      )}) AND ("contents" = ${makePositionalParam(
        3
      )}) AND (NOT "title" = ${makePositionalParam(
        4
      )}) AND ("nbr" = ${makePositionalParam(5)})`,
      values: ['%foo%', 'bar', 'content', 'foobar', 5],
    })
  })

  test('update query', (t) => {
    const { tbl } = t.context
    const stmt = tbl
      .update({
        data: { title: 'Foo', contents: 'Bar' },
        where: { id: '1' },
      })
      .toParam()

    t.deepEqual(stmt, {
      text: `UPDATE "Post" SET "title" = ${makePositionalParam(
        1
      )}, "contents" = ${makePositionalParam(
        2
      )} WHERE ("id" = ${makePositionalParam(
        3
      )}) RETURNING "id", "title", "contents", "nbr"`,
      values: ['Foo', 'Bar', '1'],
    })
  })

  test('updateMany query', (t) => {
    const { tbl } = t.context
    const stmt = tbl
      .updateMany({
        data: { title: 'Foo', contents: 'Bar' },
        // `where` argument must not be provided when using the actual API because it is added as default by the validator
        // but since we directly use the query builder we need to provide it
        where: {},
      })
      .toParam()

    t.deepEqual(stmt, {
      text: `UPDATE "Post" SET "title" = ${makePositionalParam(
        1
      )}, "contents" = ${makePositionalParam(
        2
      )} RETURNING "id", "title", "contents", "nbr"`,
      values: ['Foo', 'Bar'],
    })
  })

  test('delete query', (t) => {
    const { tbl } = t.context
    const stmt = tbl
      .delete({
        where: { id: 'Foo', title: 'Bar' },
      })
      .toParam()

    t.deepEqual(stmt, {
      text: `DELETE FROM "Post" WHERE ("id" = ${makePositionalParam(
        1
      )}) AND ("title" = ${makePositionalParam(2)})`,
      values: ['Foo', 'Bar'],
    })
  })

  test('deleteMany query', (t) => {
    const { tbl } = t.context
    const stmt1 = tbl
      .deleteMany({
        where: { id: 'Foo', title: 'Bar' },
      })
      .toParam()

    t.deepEqual(stmt1, {
      text: `DELETE FROM "Post" WHERE ("id" = ${makePositionalParam(
        1
      )}) AND ("title" = ${makePositionalParam(2)})`,
      values: ['Foo', 'Bar'],
    })

    const stmt2 = tbl
      .deleteMany({
        // `where` argument is not required when using the actual API because it is added as default by the validator
        // but since we directly use the query builder we need to provide it
        where: {},
      })
      .toParam()

    t.deepEqual(stmt2, {
      text: `DELETE FROM "Post"`,
      values: [],
    })
  })
}
