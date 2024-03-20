import test from 'ava'
import { ShapeManagerMock } from '../../../src/client/model/shapes'
import { schema } from '../generated'
import { KyselyBuilder } from '../../../src/client/model/kyselyBuilder'
import { ZodError } from 'zod'

const shapeManager = new ShapeManagerMock()
const postTableDescription = schema.getTableDescription('Post')

const tbl = new KyselyBuilder(
  'Post',
  ['id', 'title', 'contents', 'nbr'],
  shapeManager,
  postTableDescription
)

// Sync all shapes such that we don't get warnings on every query
shapeManager.sync({ tables: ['Post'] })

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

/*
 * The tests below check that the generated queries are correct.
 * The query builder does not validate the input, it assumes that the input it gets was already validated.
 * Input validation is currently done by the `Table` itself before building the query.
 */

test('null values are inserted as NULL', (t) => {
  const query = tbl
    .create({
      data: {
        id: 'i1',
        title: 't1',
        contents: 'c1',
        nbr: null,
      },
    })
    .compile()

  t.is(
    query.sql,
    'insert into "Post" ("id", "title", "contents", "nbr") values (?, ?, ?, ?) returning "id", "title", "contents", "nbr"'
  )
  t.deepEqual(query.parameters, ['i1', 't1', 'c1', null])
})

// Test that we can make a create query
test('create query', (t) => {
  const query = tbl
    .create({
      data: post1,
    })
    .compile()

  t.is(
    query.sql,
    'insert into "Post" ("id", "title", "contents", "nbr") values (?, ?, ?, ?) returning "id", "title", "contents", "nbr"'
  )
  t.deepEqual(query.parameters, ['i1', 't1', 'c1', 18])
})

test('createMany query', (t) => {
  const query = tbl
    .createMany({
      data: [post1, post2],
    })
    .compile()

  t.is(
    query.sql,
    'insert into "Post" ("id", "title", "contents", "nbr") values (?, ?, ?, ?), (?, ?, ?, ?)'
  )

  t.deepEqual(query.parameters, ['i1', 't1', 'c1', 18, 'i2', 't2', 'c2', 21])

  const query2 = tbl
    .createMany({
      data: [post1, post2],
      skipDuplicates: true,
    })
    .compile()

  t.is(
    query2.sql,
    'insert into "Post" ("id", "title", "contents", "nbr") values (?, ?, ?, ?), (?, ?, ?, ?) on conflict do nothing'
  )
  t.deepEqual(query2.parameters, ['i1', 't1', 'c1', 18, 'i2', 't2', 'c2', 21])
})

test('findUnique query', async (t) => {
  const query = tbl
    .findUnique({
      where: {
        id: 'i2',
        nbr: 21,
      },
    })
    .compile()

  t.is(
    query.sql,
    'select "id", "nbr", "title", "contents" from "Post" where "id" = (?) and "nbr" = (?) limit ?'
  )
  t.deepEqual(query.parameters, ['i2', 21, 2])
})

test('findUnique query with selection', (t) => {
  const query = tbl
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
    .compile()

  t.is(
    query.sql,
    'select "id", "nbr", "title" from "Post" where "id" = (?) and "nbr" = (?) limit ?'
  )
  t.deepEqual(query.parameters, ['i2', 21, 2])
})

test('findUnique query with selection of NULL value', (t) => {
  const query = tbl
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
    .compile()

  t.is(
    query.sql,
    'select "id", "nbr", "title" from "Post" where "id" = (?) and "nbr" is (?) limit ?'
  )
  t.deepEqual(query.parameters, ['i2', 'NULL', 2])
})

test('findUnique query with selection of non-NULL value', (t) => {
  const query = tbl
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
    .compile()

  t.is(
    query.sql,
    'select "id", "nbr", "title" from "Post" where "id" = (?) and "nbr" is not (?) limit ?'
  )
  t.deepEqual(query.parameters, ['i2', null, 2])
})

test('findUnique query with selection of row that does not equal a value', (t) => {
  const query = tbl
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
    .compile()

  t.is(
    query.sql,
    'select "id", "nbr", "title" from "Post" where "id" = (?) and "nbr" != (?) limit ?'
  )
  t.deepEqual(query.parameters, ['i2', 5, 2])
})

test('findUnique query supports several filters', (t) => {
  const query = tbl
    .findUnique({
      where: {
        id: 'i2',
        nbr: { not: 5, in: [1, 2, 3] },
      },
    })
    .compile()

  t.is(
    query.sql,
    'select "id", "nbr", "title", "contents" from "Post" where "id" = (?) and "nbr" in (?, ?, ?) and "nbr" != (?) limit ?'
  )
  t.deepEqual(query.parameters, ['i2', 1, 2, 3, 5, 2])
})

test('findUnique query with no filters throws an error', (t) => {
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
  const query = tbl
    .findMany({
      // `where` argument must not be provided when using the actual API because it is added as default by the validator
      // but since we directly use the query builder we need to provide it
      where: {},
      orderBy: {
        id: 'asc',
      },
    })
    .compile()

  t.is(
    query.sql,
    'select "id", "title", "contents", "nbr" from "Post" order by "id" asc'
  )
})

test('findMany allows results to be ordered on several fields', (t) => {
  const query = tbl
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
    .compile()

  t.is(
    query.sql,
    'select "id", "title", "contents", "nbr" from "Post" order by "id" asc, "title" desc'
  )
})

test('findMany supports pagination', (t) => {
  const query = tbl
    .findMany({
      // `where` argument must not be provided when using the actual API because it is added as default by the validator
      // but since we directly use the query builder we need to provide it
      where: {},
      take: 1,
      skip: 1,
    })
    .compile()

  t.is(
    query.sql,
    'select "id", "title", "contents", "nbr" from "Post" limit ? offset ?'
  )
  t.deepEqual(query.parameters, [1, 1])
})

test('findMany supports distinct results', (t) => {
  const query = tbl
    .findMany({
      // `where` argument must not be provided when using the actual API because it is added as default by the validator
      // but since we directly use the query builder we need to provide it
      where: {},
      distinct: ['nbr'],
    })
    .compile()

  t.is(
    query.sql,
    'select distinct on ("nbr") "id", "title", "contents", "nbr" from "Post"'
  )
})

test('findMany supports IN filters in where argument', (t) => {
  const query = tbl
    .findMany({
      where: {
        nbr: {
          in: [1, 5, 18],
        },
      },
    })
    .compile()

  t.is(
    query.sql,
    'select "nbr", "id", "title", "contents" from "Post" where "nbr" in (?, ?, ?)'
  )
  t.deepEqual(query.parameters, [1, 5, 18])
})

test('findMany supports NOT IN filters in where argument', (t) => {
  const query = tbl
    .findMany({
      where: {
        nbr: {
          notIn: [1, 5, 18],
        },
      },
    })
    .compile()

  t.is(
    query.sql,
    'select "nbr", "id", "title", "contents" from "Post" where "nbr" not in (?, ?, ?)'
  )
  t.deepEqual(query.parameters, [1, 5, 18])
})

test('findMany supports lt, lte, gt, gte filters in where argument', (t) => {
  const query = tbl
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
    .compile()

  t.is(
    query.sql,
    'select "nbr", "id", "title", "contents" from "Post" where "nbr" < (?) and "nbr" <= (?) and "nbr" > (?) and "nbr" >= (?)'
  )
  t.deepEqual(query.parameters, [11, 10, 4, 5])
})

test('findMany supports startsWith filter in where argument', (t) => {
  const query = tbl
    .findMany({
      where: {
        title: {
          startsWith: 'foo',
        },
      },
    })
    .compile()

  t.is(
    query.sql,
    'select "title", "id", "contents", "nbr" from "Post" where "title" like (?)'
  )
  t.deepEqual(query.parameters, ['foo%'])
})

test('findMany supports endsWith filter in where argument', (t) => {
  const query = tbl
    .findMany({
      where: {
        title: {
          endsWith: 'foo',
        },
      },
    })
    .compile()

  t.is(
    query.sql,
    'select "title", "id", "contents", "nbr" from "Post" where "title" like (?)'
  )
  t.deepEqual(query.parameters, ['%foo'])
})

test('findMany supports contains filter in where argument', (t) => {
  const query = tbl
    .findMany({
      where: {
        title: {
          contains: 'foo',
        },
      },
    })
    .compile()

  t.is(
    query.sql,
    'select "title", "id", "contents", "nbr" from "Post" where "title" like (?)'
  )
  t.deepEqual(query.parameters, ['%foo%'])
})

test('findMany supports boolean filters in where argument', (t) => {
  const query = tbl
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
    .compile()

  t.is(
    query.sql,
    'select "nbr", "id", "title", "contents" from "Post" where ("title" like (?) or "title" = (?)) and "contents" = (?) and "nbr" = (?) and (not "title" = (?) and not "title" = (?)) and "nbr" = (?)'
  )
  t.deepEqual(query.parameters, [
    '%foo%',
    'bar',
    'content',
    6,
    'foobar',
    'barfoo',
    5,
  ])
})

test('findMany supports single AND filter and single NOT filter in where argument', (t) => {
  const query = tbl
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
    .compile()

  t.is(
    query.sql,
    'select "nbr", "id", "title", "contents" from "Post" where ("title" like (?) or "title" = (?)) and "contents" = (?) and not "title" = (?) and "nbr" = (?)'
  )
  t.deepEqual(query.parameters, ['%foo%', 'bar', 'content', 'foobar', 5])
})

test('update query', (t) => {
  const query = tbl
    .update({
      data: { title: 'Foo', contents: 'Bar' },
      where: { id: '1' },
    })
    .compile()

  t.is(
    query.sql,
    'update "Post" set "title" = ?, "contents" = ? where "id" = (?) returning "id", "title", "contents", "nbr"'
  )
  t.deepEqual(query.parameters, ['Foo', 'Bar', '1'])
})

test('updateMany query', (t) => {
  const query1 = tbl
    .updateMany({
      data: { title: 'Foo', contents: 'Bar' },
      // `where` argument must not be provided when using the actual API because it is added as default by the validator
      // but since we directly use the query builder we need to provide it
      where: {},
    })
    .compile()

  const sql =
    'update "Post" set "title" = ?, "contents" = ? returning "id", "title", "contents", "nbr"'

  t.is(query1.sql, sql)
  t.deepEqual(query1.parameters, ['Foo', 'Bar'])
})

test('delete query', (t) => {
  const query = tbl
    .delete({
      where: { id: 'Foo', title: 'Bar' },
    })
    .compile()

  t.is(query.sql, 'delete from "Post" where "id" = (?) and "title" = (?)')
  t.deepEqual(query.parameters, ['Foo', 'Bar'])
})

test('deleteMany query', (t) => {
  const query1 = tbl
    .deleteMany({
      where: { id: 'Foo', title: 'Bar' },
    })
    .compile()

  t.is(query1.sql, 'delete from "Post" where "id" = (?) and "title" = (?)')
  t.deepEqual(query1.parameters, ['Foo', 'Bar'])

  const query2 = tbl
    .deleteMany({
      // `where` argument is not required when using the actual API because it is added as default by the validator
      // but since we directly use the query builder we need to provide it
      where: {},
    })
    .compile()

  const sql = 'delete from "Post"'
  t.is(query2.sql, sql)
})
