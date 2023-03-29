import { z } from 'zod'
import test from 'ava'

import {
  PostCreateInputSchema,
  PostUncheckedCreateInputSchema,
  UserCreateInputSchema,
  Prisma,
  UserUncheckedCreateInputSchema,
  PostFindUniqueArgsSchema,
  UserFindUniqueArgsSchema,
  PostCreateManyArgsSchema,
  UserCreateManyArgsSchema,
  UserCreateArgsSchema,
  UserFindFirstArgsSchema,
  UserUpdateArgsSchema,
  UserUpdateManyArgsSchema,
  UserUpsertArgsSchema,
  UserDeleteArgsSchema,
  UserDeleteManyArgsSchema,
  PostCreateArgsSchema,
  PostFindFirstArgsSchema,
  PostUpdateArgsSchema,
  PostUpdateManyArgsSchema,
  PostDeleteArgsSchema,
  PostUpsertArgsSchema,
  PostDeleteManyArgsSchema,
} from './generated/post'
import { Table } from '../../src/client/model/table'

import Database, { SqliteError } from 'better-sqlite3'
import { electrify } from '../../src/drivers/better-sqlite3/index'
import { InvalidArgumentError } from '../../src/client/validation/errors/invalidArgumentError'
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
type Arity = 'one' | 'many'
class Relation {
  constructor(
    public relationField: string,
    public fromField: string,
    public toField: string,
    public relatedTable: string,
    public relationName: string,
    // 'one' if this object can have only one related object,
    // 'many' if this object potentially has many related objects
    public relatedObjects: Arity
  ) {}

  isIncomingRelation(): boolean {
    return this.fromField === '' && this.toField === ''
  }

  isOutgoingRelation(): boolean {
    return !this.isIncomingRelation()
  }

  getOppositeRelation<DB extends DbSchemas>(
    dbDescription: DBDescription<DB>
  ): Relation {
    return dbDescription.getRelation(this.relatedTable, this.relationName)
  }
}

class DBDescription<DB extends DbSchemas> {
  constructor(private db: DB) {}
  getSchema(table: string): ZObject<any> {
    return this.db[table]
  }

  getRelationName(table: string, field: string): string {
    return this.getRelations(table).find((r) => r.relationField === field)!
      .relationName
  }

  getRelation(table: string, relation: string): Relation {
    return this.getRelations(table).find((r) => r.relationName === relation)!
  }

  // Profile.post <-> Post.profile (from: profileId, to: id)
  getRelations(table: string): Relation[] {
    if (table === 'User') {
      return [new Relation('posts', '', '', 'Post', 'PostsToAuthor', 'many')]
    } else if (table === 'Post') {
      return [
        new Relation(
          'author',
          'authorId',
          'id',
          'User',
          'PostsToAuthor',
          'one'
        ),
      ]
    } else return []
  }

  getOutgoingRelations(table: string): Relation[] {
    if (table === 'Post') {
      return [
        new Relation(
          'author',
          'authorId',
          'id',
          'User',
          'PostsToAuthor',
          'one'
        ),
      ]
    } else {
      return []
    }
  }

  getIncomingRelations(table: string): Relation[] {
    if (table === 'User') {
      return [new Relation('posts', '', '', 'Post', 'PostsToAuthor', 'many')]
    } else {
      return []
    }
  }
}

const dbDescription = new DBDescription(dbSchemas)

// Augment the HKT module with a mapping from 'SelectSubset' to the actual type
// cf. https://ybogomolov.me/higher-kinded-data/
declare module 'fp-ts/HKT' {
  interface URItoKind<A> {
    PostGetPayload: Prisma.PostGetPayload<A>
    UserGetPayload: Prisma.UserGetPayload<A>
  }
}

const postTable = new Table<
  Post,
  Prisma.PostCreateArgs['data'],
  Prisma.PostUpdateArgs['data'],
  Prisma.PostFindFirstArgs['select'],
  Prisma.PostFindFirstArgs['where'],
  Prisma.PostFindUniqueArgs['where'],
  Omit<Prisma.PostInclude, '_count'>, // omit count since we do not support it yet
  Prisma.PostFindFirstArgs['orderBy'],
  Prisma.PostScalarFieldEnum,
  'PostGetPayload'
  //Prisma.PostCreateArgs,
  //Omit<Prisma.PostCreateManyArgs, 'data'> & { data: Array<Prisma.PostCreateManyInput> },
  //Prisma.PostFindUniqueArgs
>(
  'Post',
  (PostCreateInputSchema as any)
    .partial()
    .or((PostUncheckedCreateInputSchema as any).partial()),
  electric.adapter,
  electric.notifier,
  dbDescription,
  PostCreateArgsSchema,
  PostCreateManyArgsSchema,
  PostFindUniqueArgsSchema,
  PostFindFirstArgsSchema,
  PostUpdateArgsSchema,
  PostUpdateManyArgsSchema,
  PostUpsertArgsSchema,
  PostDeleteArgsSchema,
  PostDeleteManyArgsSchema
)
electric.db.Post = postTable

type User = z.infer<typeof UserCreateInputSchema>
const userTable = new Table<
  User,
  Prisma.UserCreateArgs['data'],
  Prisma.UserUpdateArgs['data'],
  Prisma.UserFindFirstArgs['select'],
  Prisma.UserFindFirstArgs['where'],
  Prisma.UserFindUniqueArgs['where'],
  Omit<Prisma.UserInclude, '_count'>, // omit count since we do not support it yet
  Prisma.UserFindFirstArgs['orderBy'],
  Prisma.UserScalarFieldEnum,
  'UserGetPayload'
  // TODO: when generating the tables we will need to do this below:
  //       because Prisma allows users to pass either the object or an array of objects
  //       we (and also the generated schema) only support an array of objects
  //Omit<Prisma.UserCreateManyArgs, 'data'> & { data: Array<Prisma.UserCreateManyInput> },
  //{ data: Array<Prisma.UserCreateManyInput>, skipDuplicates?: boolean }, //Prisma.UserCreateManyArgs,
  //Prisma.UserFindUniqueArgs
>(
  'User',
  (UserCreateInputSchema as any)
    .partial()
    .or((UserUncheckedCreateInputSchema as any).partial()),
  electric.adapter,
  electric.notifier,
  dbDescription,
  UserCreateArgsSchema,
  UserCreateManyArgsSchema,
  UserFindUniqueArgsSchema,
  UserFindFirstArgsSchema,
  UserUpdateArgsSchema,
  UserUpdateManyArgsSchema,
  UserUpsertArgsSchema,
  UserDeleteArgsSchema,
  UserDeleteManyArgsSchema
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

// TODO: write test with nested includes (e.g. introduce a category table and every post has 1 category)
//       then check that we can find users and include their authored posts and include the category of those posts
//       do this when we have automated the generation such that we don't need to manually define all those tables
//       schemas, etc.

const tbl = postTable

const post1 = {
  id: 1,
  title: 't1',
  contents: 'c1',
  nbr: 18,
  authorId: 1,
}

const commonNbr = 21

const post2 = {
  id: 2,
  title: 't2',
  contents: 'c2',
  nbr: commonNbr,
  authorId: 1,
}

const post3 = {
  id: 3,
  title: 't2',
  contents: 'c3',
  nbr: commonNbr,
  authorId: 2,
}

const author1 = {
  id: 1,
  name: 'alice',
}

const author2 = {
  id: 2,
  name: 'bob',
}

const sortById = (arr: Array<Post>) => arr.sort((a, b) => b.id - a.id)

// Create a Post table in the DB first
function clear() {
  //db.exec('DROP TABLE IF EXISTS Post')
  //db.exec(
  //  "CREATE TABLE IF NOT EXISTS Post('id' int PRIMARY KEY, 'title' varchar, 'contents' varchar, 'nbr' int);"
  //)
  db.exec('DROP TABLE IF EXISTS Post')
  db.exec(
    "CREATE TABLE IF NOT EXISTS Post('id' int PRIMARY KEY, 'title' varchar, 'contents' varchar, 'nbr' int, 'authorId' int);"
  )
  db.exec('DROP TABLE IF EXISTS User')
  db.exec(
    "CREATE TABLE IF NOT EXISTS User('id' int PRIMARY KEY, 'name' varchar);"
  )
}

clear()

test.serial('create query inserts NULL for undefined values', async (t) => {
  const res = await tbl.create({
    data: {
      id: 1,
      title: 't1',
      contents: 'c1',
      nbr: undefined,
      authorId: 1,
    },
  })

  t.deepEqual(res, {
    id: 1,
    title: 't1',
    contents: 'c1',
    nbr: null,
    authorId: 1,
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
      authorId: 1,
    },
  })

  t.deepEqual(res, {
    id: 1,
    title: 't1',
    contents: 'c1',
    nbr: null,
    authorId: 1,
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
        authorId: 1,
      },
    })

    t.deepEqual(res, {
      id: 1,
      title: 't1',
      contents: 'c1',
      nbr: null,
      authorId: 1,
    })

    clear()
  }
)

test.serial('create query with nested object for outgoing FK', async (t) => {
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

test.serial('create query with nested objects for incoming FK', async (t) => {
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

  const relatedPost1 = await postTable.findUnique({
    where: {
      id: 5,
    },
  })

  const relatedPost2 = await postTable.findUnique({
    where: {
      id: 6,
    },
  })

  t.deepEqual(relatedPost1, {
    id: 5,
    title: 'foo',
    contents: 'bar',
    nbr: null,
    authorId: 1094,
  })

  t.deepEqual(relatedPost2, {
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
  const res = await tbl.create({
    data: post1,
  })

  t.deepEqual(res, post1)

  clear()
})

test.serial('create query supports include argument', async (t) => {
  await userTable.createMany({
    data: [author1, author2],
  })

  const res = await tbl.create({
    data: post1,
    include: {
      author: true,
    },
  })

  t.deepEqual(res, {
    ...post1,
    author: author1,
  })
})

test.serial(
  'create query throws an error if primary key already exists',
  async (t) => {
    const record = {
      id: post1.id,
      title: 'some title',
      contents: 'some contents',
      nbr: 18,
      authorId: 1,
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
      //nbr: post2.nbr,
    },
  })

  t.deepEqual(res, post2)
})

test.serial('findUnique query with selection', async (t) => {
  const res = await tbl.findUnique({
    where: {
      id: post2.id,
    },
    select: {
      title: true,
      contents: false,
    },
  })

  t.deepEqual(res, {
    id: post2.id, // fields provided in `where` argument are always returned even if they are not selected
    title: post2.title,
  })
})

test.serial('findUnique query with include', async (t) => {
  const res = await tbl.findUnique({
    where: {
      id: post2.id,
    },
    include: {
      author: true,
    },
  })

  t.deepEqual(res, {
    ...post2,
    author: author1,
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
          //nbr: 21,
        },
        select: {
          contents: false,
        },
      })
    })
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

test.serial('findFirst query supports include', async (t) => {
  const res = await tbl.findFirst({
    where: {
      nbr: commonNbr,
    },
    include: {
      author: true,
    },
  })

  t.deepEqual(res, {
    ...post2,
    author: author1,
  })
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

test.serial(
  'findMany can fetch related objects based on outgoing FK of one-to-many relation',
  async (t) => {
    const res = await tbl.findMany({
      where: {
        id: {
          in: [1, 3], // fetch post 1 and 3
        },
      },
      include: {
        author: true,
      },
    })

    t.deepEqual(
      sortById(res),
      sortById([
        {
          id: 1,
          title: 't1',
          contents: 'c1',
          nbr: 18,
          authorId: 1,
          author: author1,
        },
        {
          id: 3,
          title: 't2',
          contents: 'c3',
          nbr: commonNbr,
          authorId: 2,
          author: author2,
        },
      ])
    )

    const res2 = await tbl.findMany({
      where: {
        id: {
          in: [1, 3], // fetch post 1 and 3
        },
      },
      include: {
        author: {
          select: {
            id: true,
          },
        },
      },
    })

    t.deepEqual(
      sortById(res2),
      sortById([
        {
          id: 1,
          title: 't1',
          contents: 'c1',
          nbr: 18,
          authorId: 1,
          author: {
            id: author1.id,
          },
        },
        {
          id: 3,
          title: 't2',
          contents: 'c3',
          nbr: commonNbr,
          authorId: 2,
          author: {
            id: author2.id,
          },
        },
      ])
    )
  }
)

test.serial(
  'findMany can fetch related objects based on incoming FK of one-to-many relation',
  async (t) => {
    const res = await userTable.findMany({
      where: {
        id: 1,
      },
      include: {
        posts: true,
      },
    })

    t.deepEqual(res, [
      {
        ...author1,
        posts: [post1, post2],
      },
    ])
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

  // Also include the author
  const res4 = await tbl.update({
    data: { id: post1.id }, // doesn't actually change it, but doesn't matter for this test
    where: { id: post1.id },
    include: { author: true },
  })

  t.deepEqual(res4, {
    ...post1,
    author: author1,
  })
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
      } as UpdateInput<any, any, any>) // mislead the type checker to see that it is caught at runtime
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
        where: { id: -3 },
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
    } as unknown as UpdateManyInput<any, any>) // mislead the type checker to see that it is caught at runtime
  })
})

test.serial('upsert query', async (t) => {
  const newPost = {
    id: 4,
    title: 't4',
    contents: 'c4',
    nbr: 5,
    authorId: 1,
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

test.serial('upsert supports include argument', async (t) => {
  const newPost = {
    id: 356,
    title: 't4',
    contents: 'c4',
    nbr: 5,
    authorId: 1,
  }
  const updatePost = { title: 'Modified title' }

  // There is no post with identifier `i4` so it will be created
  const res1 = await tbl.upsert({
    create: newPost,
    update: updatePost,
    where: {
      id: newPost.id,
    },
    include: {
      author: true,
    },
  })

  t.deepEqual(res1, {
    ...newPost,
    author: author1,
  })

  // Now, identifier `i4` exists, so it will update
  const res2 = await tbl.upsert({
    create: newPost,
    update: updatePost,
    where: {
      id: newPost.id,
    },
    include: {
      author: true,
    },
  })

  t.deepEqual(res2, {
    ...newPost,
    title: updatePost.title,
    author: author1,
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
            title: 'Changed', // not unique
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

test.serial('delete query supports include argument', async (t) => {
  const p1 = await tbl.findUnique({
    where: { id: post1.id },
  })

  const res = await tbl.delete({
    where: { id: post1.id },
    include: { author: true },
  })

  t.deepEqual(res, {
    ...p1,
    author: author1,
  })

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
    await tbl.delete({} as DeleteInput<any, any>) // mislead the type checker to see that it is caught at runtime
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
            title: 'Changed',
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
  t.deepEqual(res2, { count: 4 })

  const emptyPosts = await tbl.findMany({})
  t.is(emptyPosts.length, 0)
})
