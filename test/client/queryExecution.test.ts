import { z } from 'zod'
import test from 'ava'

import {
  PostCreateInputSchema,
  PostUncheckedCreateInputSchema,
  PostIncludeSchema,
  PostSelectSchema,
  UserCreateInputSchema,
  Prisma,
  UserUncheckedCreateInputSchema,
  UserSelectSchema,
  UserIncludeSchema,
  PostFindUniqueArgsSchema,
  UserFindUniqueArgsSchema,
} from './generated/post'
import { Table } from '../../src/client/model/table'

import Database, { SqliteError } from 'better-sqlite3'
import { electrify } from '../../src/drivers/better-sqlite3/index'
import { InvalidArgumentError } from '../../src/client/validation/errors/invalidArgumentError'
import { SelectInput } from '../../src/client/input/findInput'
import {
  UpdateInput,
  UpdateManyInput,
} from '../../src/client/input/updateInput'
import { DeleteInput } from '../../src/client/input/deleteInput'
import {
  _NOT_UNIQUE_,
  _RECORD_NOT_FOUND_,
} from '../../src/client/validation/errors/messages'
import { DbSchemas } from '../../src/client/model/dalNamespace'
import { ZObject } from '../../src/client/validation/schemas'

const strictPostSchema = PostCreateInputSchema //Post
//type PostSchema = typeof strictPostSchema
type Post = z.infer<typeof PostCreateInputSchema>

const dbSchemas = {
  Post: strictPostSchema,
  User: UserCreateInputSchema,
}

const db = new Database(':memory:')
const electric = await electrify(db, dbSchemas, {
  app: 'CRUD-Test',
  env: 'env',
  migrations: [],
})

/////
class Relation {
  constructor(
    public relationField: string,
    public fromField: string,
    public toField: string,
    public relatedTable: string,
    public relationName: string
  ) {}
}

class DBDescription<DB extends DbSchemas> {
  constructor(private db: DB) {}
  getSchema(table: string): ZObject<any> {
    return this.db[table]
  }

  getRelationName(_table: string, _field: string): undefined {
    return undefined
  }

  getRelation(table: string, relation: string): Relation {
    return this.getRelations(table).find((r) => r.relationName === relation)!
  }

  // Profile.post <-> Post.profile (from: profileId, to: id)
  getRelations(table: string): Relation[] {
    if (table === 'User') {
      return [new Relation('posts', '', '', 'Post', 'PostsToAuthor')]
    } else if (table === 'Post') {
      return [new Relation('author', 'authorId', 'id', 'User', 'PostsToAuthor')]
    } else return []
  }

  getOutgoingRelations(table: string): Relation[] {
    if (table === 'Post') {
      return [new Relation('author', 'authorId', 'id', 'User', 'PostsToAuthor')]
    } else {
      return []
    }
  }

  getIncomingRelations(table: string): Relation[] {
    if (table === 'User') {
      return [new Relation('posts', '', '', 'Post', 'PostsToAuthor')]
    } else {
      return []
    }
  }
}

const dbDescription = new DBDescription(dbSchemas)

const postTable = new Table<
  Post,
  Prisma.PostCreateArgs,
  Prisma.PostFindUniqueArgs
>(
  'Post',
  (PostCreateInputSchema as any)
    .partial()
    .or((PostUncheckedCreateInputSchema as any).partial()),
  electric.adapter,
  electric.notifier,
  z.object({
    data: PostCreateInputSchema.or(PostUncheckedCreateInputSchema),
    select: PostSelectSchema.nullish(),
    include: PostIncludeSchema.nullish(),
  }) as any,
  PostFindUniqueArgsSchema,
  dbDescription
)
electric.db.Post = postTable

type User = z.infer<typeof UserCreateInputSchema>
const userTable = new Table<
  User,
  Prisma.UserCreateArgs,
  Prisma.UserFindUniqueArgs
>(
  'User',
  (UserCreateInputSchema as any)
    .partial()
    .or((UserUncheckedCreateInputSchema as any).partial()),
  electric.adapter,
  electric.notifier,
  z.object({
    data: UserCreateInputSchema.or(UserUncheckedCreateInputSchema),
    select: UserSelectSchema.nullish(),
    include: UserIncludeSchema.nullish(),
  }) as any,
  UserFindUniqueArgsSchema,
  dbDescription
)
electric.db.User = userTable

// Map<TableName, Table<any, any, any, any>>
const tablesMap = new Map([
  ['Post', electric.db.Post],
  ['User', electric.db.User],
])
electric.db.Post.setTables(tablesMap)
electric.db.User.setTables(tablesMap)

/////

const tbl = postTable

const post1 = {
  id: 1,
  title: 't1',
  contents: 'c1',
  nbr: 18,
}

const commonNbr = 21

const post2 = {
  id: 2,
  title: 't2',
  contents: 'c2',
  nbr: commonNbr,
}

const post3 = {
  id: 3,
  title: 't2',
  contents: 'c3',
  nbr: commonNbr,
}

// Create a Post table in the DB first
function clear() {
  db.exec('DROP TABLE IF EXISTS Post')
  db.exec(
    "CREATE TABLE IF NOT EXISTS Post('id' int PRIMARY KEY, 'title' varchar, 'contents' varchar, 'nbr' int);"
  )
}

clear()

test.serial('table should throw an error on invalid schemas', (t) => {
  t.throws<TypeError>(
    () => {
      new Table<Post, Prisma.PostCreateArgs>(
        'Post',
        z.string() as unknown as ZObject<Post>,
        null as any,
        null as any,
        null as any,
        null as any
      ) // mislead the type checker to test that it throws an error at runtime
    },
    {
      instanceOf: TypeError,
      message: 'Invalid schema. Must be an object schema.',
    }
  )
})

test.serial('create query inserts NULL for undefined values', async (t) => {
  const res = await tbl.create({
    data: {
      id: 1,
      title: 't1',
      contents: 'c1',
      nbr: undefined,
    },
  })

  t.deepEqual(res, {
    id: 1,
    title: 't1',
    contents: 'c1',
    nbr: null,
  })

  clear()
})

test.serial('create query handles null values correctly', async (t) => {
  const res = await tbl.create({
    data: {
      id: 1,
      title: 't1',
      contents: 'c1',
      nbr: null,
    },
  })

  t.deepEqual(res, {
    id: 1,
    title: 't1',
    contents: 'c1',
    nbr: null,
  })

  clear()
})

test.serial(
  'create query inserts NULL values for missing fields',
  async (t) => {
    const res = await tbl.create({
      data: {
        id: 1,
        title: 't1',
        contents: 'c1',
      },
    })

    t.deepEqual(res, {
      id: 1,
      title: 't1',
      contents: 'c1',
      nbr: null,
    })

    clear()
  }
)

test.serial('create query with nested object for outgoing FK', async (t) => {
  db.exec('DROP TABLE IF EXISTS Post')
  db.exec(
    "CREATE TABLE IF NOT EXISTS Post('id' int PRIMARY KEY, 'title' varchar, 'contents' varchar, 'nbr' int, 'authorId' int);"
  )
  db.exec('DROP TABLE IF EXISTS User')
  db.exec(
    "CREATE TABLE IF NOT EXISTS User('id' int PRIMARY KEY, 'name' varchar);"
  )

  const res = await tbl.create({
    data: {
      id: 5,
      title: 'foo',
      contents: 'bar',
      author: {
        create: {
          id: 1094,
          name: 'kevin',
        },
      },
      //authorId: 1
    },
  })

  t.deepEqual(res, {
    id: 5,
    title: 'foo',
    contents: 'bar',
    nbr: null,
    authorId: 1094,
  })

  const relatedUser = await userTable.findUnique({
    where: {
      id: 1094,
    },
  })

  t.deepEqual(relatedUser, {
    id: 1094,
    name: 'kevin',
  })

  clear()
})

test.serial('create query with nested object for incoming FK', async (t) => {
  db.exec('DROP TABLE IF EXISTS Post')
  db.exec(
    "CREATE TABLE IF NOT EXISTS Post('id' int PRIMARY KEY, 'title' varchar, 'contents' varchar, 'nbr' int, 'authorId' int);"
  )
  db.exec('DROP TABLE IF EXISTS User')
  db.exec(
    "CREATE TABLE IF NOT EXISTS User('id' int PRIMARY KEY, 'name' varchar);"
  )

  const res = await userTable.create({
    data: {
      id: 1094,
      name: 'kevin',
      posts: {
        create: [
          {
            id: 5,
            title: 'foo',
            contents: 'bar',
          },
          {
            id: 6,
            title: 'test',
            contents: 'nested post',
          },
        ],
      },
    },
  })

  t.deepEqual(res, {
    id: 1094,
    name: 'kevin',
  })

  const relatedUser1 = await postTable.findUnique({
    where: {
      id: 5,
    },
  })

  const relatedUser2 = await postTable.findUnique({
    where: {
      id: 6,
    },
  })

  t.deepEqual(relatedUser1, {
    id: 5,
    title: 'foo',
    contents: 'bar',
    nbr: null,
    authorId: 1094,
  })

  t.deepEqual(relatedUser2, {
    id: 6,
    title: 'test',
    contents: 'nested post',
    nbr: null,
    authorId: 1094,
  })

  clear()
})

// Test that we can make a create query
test.serial('create query', async (t) => {
  db.exec('DROP TABLE IF EXISTS Post')
  db.exec(
    "CREATE TABLE IF NOT EXISTS Post('id' int PRIMARY KEY, 'title' varchar, 'contents' varchar, 'nbr' int);"
  )

  const res = await tbl.create({
    data: {
      id: 5,
      title: 'foo',
      contents: 'bar',
    },
  })

  t.deepEqual(res, {
    id: 5,
    title: 'foo',
    contents: 'bar',
    nbr: null,
  })
})

test.serial(
  'create query throws an error if primary key already exists',
  async (t) => {
    const record = {
      id: 1,
      title: 'some title',
      contents: 'some contents',
      nbr: 18,
    }

    await t.throwsAsync(
      async () => {
        await tbl.create({
          data: record,
        })
      },
      {
        instanceOf: SqliteError,
        message: 'UNIQUE constraint failed: Post.id',
      }
    )
  }
)

test.serial('createMany query', async (t) => {
  const res = await tbl.createMany({
    data: [post2, post3],
  })

  t.deepEqual(res, { count: 2 })

  // Check that skipDuplicates argument works
  const res2 = await tbl.createMany({
    data: [post2, post3],
    skipDuplicates: true,
  })

  t.deepEqual(res2, { count: 0 })
})

test.serial('findUnique query', async (t) => {
  const res = await tbl.findUnique({
    where: {
      id: post2.id,
      nbr: post2.nbr,
    },
  })

  t.deepEqual(res, post2)
})

test.serial('findUnique query with selection', async (t) => {
  const res = await tbl.findUnique({
    where: {
      id: post2.id,
      nbr: post2.nbr,
    },
    select: {
      title: true,
      contents: false,
    },
  })

  t.deepEqual(res, {
    id: post2.id, // fields provided in `where` argument are always returned even if they are not selected
    nbr: post2.nbr,
    title: post2.title,
  })
})

test.serial(
  'findUnique query with empty `where` arguments should throw an error',
  async (t) => {
    await t.throwsAsync<InvalidArgumentError>(async () => {
      await tbl.findUnique({
        where: {},
      })
    })
  }
)

test.serial(
  'findUnique query with empty selection should throw an error',
  async (t) => {
    await t.throwsAsync<InvalidArgumentError>(async () => {
      await tbl.findUnique({
        where: {
          id: 2,
          nbr: 21,
        },
        select: {
          contents: false,
        },
      })
    })
  }
)

test.serial(
  'findUnique query throws error if record is not unique',
  async (t) => {
    await t.throwsAsync<InvalidArgumentError>(
      async () => {
        await tbl.findUnique({
          where: {
            nbr: commonNbr,
          },
        })
      },
      {
        instanceOf: InvalidArgumentError,
        message: _NOT_UNIQUE_,
      }
    )
  }
)

test.serial('findFirst query returns first result', async (t) => {
  const res = await tbl.findFirst({
    where: {
      nbr: commonNbr,
    },
  })

  t.deepEqual(res, post2)
})

test.serial(
  'selection should throw an error if object is invalid',
  async (t) => {
    await t.throwsAsync<InvalidArgumentError>(async () => {
      await tbl.findMany({
        select: {
          contents: true,
          foo: false, // field `foo` does not exist, should throw an error
        } as unknown as SelectInput<Post>, // mislead the type checker to check that it throws a runtime error
      })
    })
  }
)

test.serial('findMany allows results to be ordered', async (t) => {
  const res = await tbl.findMany({
    orderBy: [
      {
        title: 'asc',
      },
      {
        contents: 'desc',
      },
    ],
  })

  t.deepEqual(res, [post1, post3, post2])
})

test.serial('update query', async (t) => {
  // Regular update
  const res = await tbl.update({
    data: { title: 'Foo', contents: 'Bar' },
    where: { id: post1.id },
    select: { title: true, contents: true },
  })

  t.deepEqual(res, {
    title: 'Foo',
    contents: 'Bar',
  })

  // Put the title and contents back to their original value
  await tbl.update({
    data: { title: post1.title, contents: post1.contents },
    where: { id: post1.id },
  })

  // Update the primary key
  const res2 = await tbl.update({
    data: { id: 5 },
    where: { id: post1.id },
  })

  t.deepEqual(res2, {
    ...post1,
    id: 5,
  })

  // Update primary key and return only a selection
  const res3 = await tbl.update({
    data: { id: post1.id },
    where: { id: 5 },
    select: { title: true },
  })

  t.deepEqual(res3, { title: post1.title })
})

test.serial(
  'update query throws an error if where argument is invalid',
  async (t) => {
    await t.throwsAsync<z.ZodError>(async () => {
      await tbl.update({
        data: { title: 'Foo', contents: 'Bar' },
      } as unknown as UpdateInput<Post>) // mislead the type checker to see that it is caught at runtime
    })

    await t.throwsAsync<InvalidArgumentError>(async () => {
      await tbl.update({
        data: { title: 'Foo', contents: 'Bar' },
        where: {}, // cannot be empty, must at least define one field
      })
    })

    await t.throwsAsync<z.ZodError>(async () => {
      await tbl.update({
        data: { title: 'Foo', contents: 'Bar' },
        where: { foo: 1 }, // `foo` is not a field of `Post`
      } as unknown as UpdateInput<Post>) // mislead the type checker to see that it is caught at runtime
    })
  }
)

test.serial(
  'update query throws an error if more than one record matches',
  async (t) => {
    await t.throwsAsync<InvalidArgumentError>(
      async () => {
        await tbl.update({
          data: { title: 'Foo', contents: 'Bar' },
          where: { title: 't2' }, // there are two posts with this title
        })
      },
      {
        instanceOf: InvalidArgumentError,
        message: _NOT_UNIQUE_,
      }
    )
  }
)

test.serial('update query throws an error if no record matches', async (t) => {
  await t.throwsAsync<InvalidArgumentError>(
    async () => {
      await tbl.update({
        data: { title: 'Foo', contents: 'Bar' },
        where: { title: 'This title does not exist' },
      })
    },
    {
      instanceOf: InvalidArgumentError,
      message: _RECORD_NOT_FOUND_('Update'),
    }
  )
})

test.serial('updateMany query', async (t) => {
  const res = await tbl.updateMany({
    data: { title: 'Foo', contents: 'Bar' },
  })

  t.deepEqual(res, { count: 3 })

  // Check that all posts were changed
  const allPosts = await tbl.findMany({})
  allPosts.forEach((post) => {
    t.is(post.title, 'Foo')
    t.is(post.contents, 'Bar')
  })

  const res2 = await tbl.updateMany({
    data: { contents: 'Baz' },
    where: {}, // empty where clause should simply be ignored
  })

  t.deepEqual(res2, { count: 3 })

  // Check that all posts were changed
  const allPosts2 = await tbl.findMany({})
  allPosts2.forEach((post) => {
    t.is(post.contents, 'Baz')
  })

  const allPosts3 = await tbl.findMany({})

  // Update all posts that fulfill a certain condition
  const res3 = await tbl.updateMany({
    data: { title: 'Changed' },
    where: {
      nbr: commonNbr,
    },
  })

  t.deepEqual(res3, { count: 2 })

  // Check that only those posts were changed
  const allPosts4 = await tbl.findMany({})
  t.deepEqual(
    new Set(allPosts4),
    new Set(
      allPosts3.map((post) => {
        if (post.nbr == commonNbr) return { ...post, title: 'Changed' }
        else return post
      })
    )
  )

  await t.throwsAsync<z.ZodError>(async () => {
    await tbl.updateMany({
      data: { title: 'Foo', contents: 'Bar' },
      where: { foo: 1 }, // `foo` is not a field of `Post`
    } as unknown as UpdateManyInput<Post>) // mislead the type checker to see that it is caught at runtime
  })
})

test.serial('upsert query', async (t) => {
  const newPost = {
    id: 4,
    title: 't4',
    contents: 'c4',
    nbr: 5,
  }
  const updatePost = { title: 'Modified title' }

  // There is no post with identifier `i4` so it will be created
  const res1 = await tbl.upsert({
    create: newPost,
    update: updatePost,
    where: {
      id: newPost.id,
    },
  })

  t.deepEqual(res1, newPost)

  // Now, identifier `i4` exists, so it will update
  const res2 = await tbl.upsert({
    create: newPost,
    update: updatePost,
    where: {
      id: newPost.id,
    },
    select: {
      id: true,
      title: true,
      contents: true,
    },
  })

  t.deepEqual(res2, {
    id: newPost.id,
    title: updatePost.title,
    contents: newPost.contents,
  })
})

test.serial(
  'upsert query throws an error if record is not unique',
  async (t) => {
    await t.throwsAsync(
      async () => {
        await tbl.upsert({
          create: post1,
          update: {},
          where: {
            nbr: commonNbr, // not unique
          },
        })
      },
      {
        instanceOf: InvalidArgumentError,
        message: _NOT_UNIQUE_,
      }
    )
  }
)

test.serial('delete query', async (t) => {
  const p1 = await tbl.findUnique({
    where: { id: post1.id },
  })

  const res = await tbl.delete({
    where: { id: post1.id },
    select: { nbr: true },
  })

  t.deepEqual(res, { nbr: 18 })

  // Insert p1 again in the DB
  await tbl.create({ data: p1 as unknown as Post })
})

test.serial('delete query throws error if input is invalid', async (t) => {
  await t.throwsAsync<InvalidArgumentError>(async () => {
    await tbl.delete({
      where: {},
    })
  })

  await t.throwsAsync<z.ZodError>(async () => {
    await tbl.delete({} as unknown as DeleteInput<Post>) // mislead the type checker to see that it is caught at runtime
  })
})

test.serial('delete query throws error if record does not exist', async (t) => {
  await t.throwsAsync(
    async () => {
      await tbl.delete({
        where: {
          id: -1,
        },
      })
    },
    {
      instanceOf: InvalidArgumentError,
      message: _RECORD_NOT_FOUND_('Delete'),
    }
  )
})

test.serial(
  'delete query throws error if it matches more than one record',
  async (t) => {
    await t.throwsAsync(
      async () => {
        await tbl.delete({
          where: {
            nbr: commonNbr,
          },
        })
      },
      {
        instanceOf: InvalidArgumentError,
        message: _NOT_UNIQUE_,
      }
    )
  }
)

test.serial('deleteMany query', async (t) => {
  const [p1, ...rest] = await tbl.findMany({})

  const res = await tbl.deleteMany({
    where: { id: p1.id, title: p1.title },
  })

  t.deepEqual(res, { count: 1 })

  // Check that p1 is deleted and only p2 and p3 remain
  const remainingPosts = await tbl.findMany({})
  t.deepEqual(new Set(rest), new Set(remainingPosts))

  // Test deleting everything
  const res2 = await tbl.deleteMany({})
  t.deepEqual(res2, { count: 3 })

  const emptyPosts = await tbl.findMany({})
  t.is(emptyPosts.length, 0)
})
