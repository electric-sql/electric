import test from 'ava'
import { Builder } from '../../../src/client/model/builder'

const tbl = new Builder('Post', ['id', 'title', 'contents', 'nbr'])

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
    "SELECT id, nbr, title, contents FROM Post WHERE (id = ('i2')) AND (nbr = (21)) LIMIT 2"
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
    "SELECT id, nbr, title FROM Post WHERE (id = ('i2')) AND (nbr = (21)) LIMIT 2"
  )
})

test('findUnique query with selection of NULL value', (t) => {
  const query = tbl
    .findUnique({
      where: {
        id: 'i2',
        nbr: 21,
        foo: null,
      },
      select: {
        title: true,
        contents: false,
      },
    })
    .toString()

  t.is(
    query,
    "SELECT id, nbr, foo, title FROM Post WHERE (id = ('i2')) AND (nbr = (21)) AND (foo IS NULL) LIMIT 2"
  )
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

test('update query', (t) => {
  const query = tbl
    .update({
      data: { title: 'Foo', contents: 'Bar' },
      where: { id: '1' },
    })
    .toString()

  t.is(
    query,
    "UPDATE Post SET title = 'Foo', contents = 'Bar' WHERE (id = ('1')) RETURNING id, title, contents, nbr"
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

  t.is(query, "DELETE FROM Post WHERE (id = ('Foo')) AND (title = ('Bar'))")
})

test('deleteMany query', (t) => {
  const query1 = tbl
    .deleteMany({
      where: { id: 'Foo', title: 'Bar' },
    })
    .toString()

  t.is(query1, "DELETE FROM Post WHERE (id = ('Foo')) AND (title = ('Bar'))")

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
