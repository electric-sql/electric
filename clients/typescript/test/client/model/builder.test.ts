import test from 'ava'
import { Builder } from '../../../src/client/model/builder'
import { shapeManager, ShapeManagerMock } from '../../../src/client/model/shapes'
import { ZodError } from 'zod'

const tbl = new Builder('Post', ['id', 'title', 'contents', 'nbr'])

// Use a mocked shape manager for these tests
// which does not wait for Satellite
// to acknowledge the subscription
Object.setPrototypeOf(shapeManager, ShapeManagerMock.prototype)

// Sync all shapes such that we don't get warnings on every query
shapeManager.sync({ tables: [ 'Post' ] })

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
    .toString()

  t.is(
    query,
    "INSERT INTO Post (id, title, contents, nbr) VALUES ('i1', 't1', 'c1', NULL) RETURNING id, title, contents, nbr"
  )
})

// Test that we can make a create query
test('create query', (t) => {
  const query = tbl
    .create({
      data: post1,
    })
    .toString()

  t.is(
    query,
    "INSERT INTO Post (id, title, contents, nbr) VALUES ('i1', 't1', 'c1', 18) RETURNING id, title, contents, nbr"
  )
})

test('createMany query', (t) => {
  const query = tbl
    .createMany({
      data: [post1, post2],
    })
    .toString()

  t.is(
    query,
    "INSERT INTO Post (id, title, contents, nbr) VALUES ('i1', 't1', 'c1', 18), ('i2', 't2', 'c2', 21)"
  )

  const query2 = tbl
    .createMany({
      data: [post1, post2],
      skipDuplicates: true,
    })
    .toString()

  t.is(
    query2,
    "INSERT INTO Post (id, title, contents, nbr) VALUES ('i1', 't1', 'c1', 18), ('i2', 't2', 'c2', 21) ON CONFLICT DO NOTHING"
  )
})

test('findUnique query', async (t) => {
  const query = tbl
    .findUnique({
      where: {
        id: 'i2',
        nbr: 21,
      },
    })
    .toString()

  t.is(
    query,
    "SELECT id, nbr, title, contents FROM Post WHERE (id = 'i2') AND (nbr = 21) LIMIT 2"
  )
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
    .toString()

  t.is(
    query,
    "SELECT id, nbr, title FROM Post WHERE (id = 'i2') AND (nbr = 21) LIMIT 2"
  )
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
    .toString()

  t.is(
    query,
    "SELECT id, nbr, title FROM Post WHERE (id = 'i2') AND (nbr IS NULL) LIMIT 2"
  )
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
    .toString()

  t.is(
    query,
    "SELECT id, nbr, title FROM Post WHERE (id = 'i2') AND (nbr IS NOT NULL) LIMIT 2"
  )
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
    .toString()

  t.is(
    query,
    "SELECT id, nbr, title FROM Post WHERE (id = 'i2') AND (nbr != 5) LIMIT 2"
  )
})

test('findUnique query supports several filters', (t) => {
  const query = tbl
    .findUnique({
      where: {
        id: 'i2',
        nbr: { not: 5, in: [1, 2, 3] },
      },
    })
    .toString()

  t.is(
    query,
    "SELECT id, nbr, title, contents FROM Post WHERE (id = 'i2') AND (nbr IN (1, 2, 3)) AND (nbr != 5) LIMIT 2"
  )
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

test('findMany allows results to be ordered', (t) => {
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
    .toString()

  t.is(
    query,
    'SELECT id, title, contents, nbr FROM Post ORDER BY id ASC, title DESC'
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
    .toString()

  t.is(query, 'SELECT id, title, contents, nbr FROM Post LIMIT 1 OFFSET 1')
})

test('findMany supports distinct results', (t) => {
  const query = tbl
    .findMany({
      // `where` argument must not be provided when using the actual API because it is added as default by the validator
      // but since we directly use the query builder we need to provide it
      where: {},
      distinct: ['nbr'],
    })
    .toString()

  t.is(query, 'SELECT DISTINCT ON (nbr) id, title, contents, nbr FROM Post')
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
    .toString()

  t.is(
    query,
    'SELECT nbr, id, title, contents FROM Post WHERE (nbr IN (1, 5, 18))'
  )
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
    .toString()

  t.is(
    query,
    'SELECT nbr, id, title, contents FROM Post WHERE (nbr NOT IN (1, 5, 18))'
  )
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
    .toString()

  t.is(
    query,
    'SELECT nbr, id, title, contents FROM Post WHERE (nbr < 11) AND (nbr <= 10) AND (nbr > 4) AND (nbr >= 5)'
  )
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
    .toString()

  t.is(
    query,
    "SELECT title, id, contents, nbr FROM Post WHERE (title LIKE 'foo%')"
  )
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
    .toString()

  t.is(
    query,
    "SELECT title, id, contents, nbr FROM Post WHERE (title LIKE '%foo')"
  )
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
    .toString()

  t.is(
    query,
    "SELECT title, id, contents, nbr FROM Post WHERE (title LIKE '%foo%')"
  )
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
    .toString()

  t.is(
    query,
    "SELECT nbr, id, title, contents FROM Post WHERE (title LIKE '%foo%' OR title = 'bar') AND (contents = 'content' AND nbr = 6) AND ((NOT title = 'foobar') AND (NOT title = 'barfoo')) AND (nbr = 5)"
  )
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
    .toString()

  t.is(
    query,
    "SELECT nbr, id, title, contents FROM Post WHERE (title LIKE '%foo%' OR title = 'bar') AND (contents = 'content') AND (NOT title = 'foobar') AND (nbr = 5)"
  )
})

test('update query', (t) => {
  const query = tbl
    .update({
      data: { title: 'Foo', contents: 'Bar' },
      where: { id: '1' },
    })
    .toString()

  t.is(
    query,
    "UPDATE Post SET title = 'Foo', contents = 'Bar' WHERE (id = '1') RETURNING id, title, contents, nbr"
  )
})

test('updateMany query', (t) => {
  const query1 = tbl
    .updateMany({
      data: { title: 'Foo', contents: 'Bar' },
      // `where` argument must not be provided when using the actual API because it is added as default by the validator
      // but since we directly use the query builder we need to provide it
      where: {},
    })
    .toString()

  const sql =
    "UPDATE Post SET title = 'Foo', contents = 'Bar' RETURNING id, title, contents, nbr"

  t.is(query1, sql)
})

test('delete query', (t) => {
  const query = tbl
    .delete({
      where: { id: 'Foo', title: 'Bar' },
    })
    .toString()

  t.is(query, "DELETE FROM Post WHERE (id = 'Foo') AND (title = 'Bar')")
})

test('deleteMany query', (t) => {
  const query1 = tbl
    .deleteMany({
      where: { id: 'Foo', title: 'Bar' },
    })
    .toString()

  t.is(query1, "DELETE FROM Post WHERE (id = 'Foo') AND (title = 'Bar')")

  const query2 = tbl
    .deleteMany({
      // `where` argument is not required when using the actual API because it is added as default by the validator
      // but since we directly use the query builder we need to provide it
      where: {},
    })
    .toString()

  const sql = 'DELETE FROM Post'
  t.is(query2, sql)
})
