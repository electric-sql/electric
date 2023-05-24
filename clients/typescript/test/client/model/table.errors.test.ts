import test from 'ava'
import Database from 'better-sqlite3'
import { electrify } from '../../../src/drivers/better-sqlite3'
import { dbSchema } from '../generated'
import { ZodError } from 'zod'
import { InvalidArgumentError } from '../../../src/client/validation/errors/invalidArgumentError'

/*
 * This test file is meant to check that the DAL
 * reports unrecognized/unsupported arguments
 * through both type errors and runtime errors.
 */

const db = new Database(':memory:')
const electric = await electrify(db, dbSchema, {
    app: 'CRUD-Test',
    env: 'env',
    migrations: []
  },
  { token: 'test-token' }
)
//const postTable = electric.db.Post
const userTable = electric.db.User

test.beforeEach((_t) => {
  db.exec('DROP TABLE IF EXISTS Post')
  db.exec(
    "CREATE TABLE IF NOT EXISTS Post('id' int PRIMARY KEY, 'title' varchar, 'contents' varchar, 'nbr' int, 'authorId' int);"
  )
  db.exec('DROP TABLE IF EXISTS User')
  db.exec(
    "CREATE TABLE IF NOT EXISTS User('id' int PRIMARY KEY, 'name' varchar);"
  )
})

test('create query throws error for unsupported _count argument', async (t) => {
  await t.throwsAsync(
    async () => {
      await userTable.create({
        data: {
          id: 1,
          name: 't1',
        },
        select: {
          // @ts-expect-error: Unsupported argument
          _count: true,
        },
      })
    },
    { instanceOf: ZodError }
  )
})

test('create query throws error when selecting related objects', async (t) => {
  await t.throwsAsync(
    async () => {
      await userTable.create({
        data: {
          id: 1,
          name: 't1',
        },
        select: {
          name: true,
          // @ts-expect-error: We do not yet support selecting related objects (use include instead)
          posts: {
            take: 5,
          },
        },
      })
    },
    {
      instanceOf: InvalidArgumentError,
      message:
        "Cannot select field posts on table User. Use 'include' to fetch related objects.",
    }
  )
})

// TODO: allow select to fetch related objects (currently only supported by include)

test('create query throws error for unsupported cursor argument', async (t) => {
  await t.throwsAsync(
    async () => {
      await userTable.create({
        data: {
          id: 1,
          name: 't1',
        },
        include: {
          posts: {
            take: 5,
            // @ts-expect-error: Unsupported argument
            cursor: {
              id: 2,
            },
          },
        },
      })
    },
    {
      instanceOf: InvalidArgumentError,
      message: 'Unsupported cursor argument.',
    }
  )
})

test('create query throws error for createMany on related object', async (t) => {
  await t.throwsAsync(
    async () => {
      await userTable.create({
        data: {
          id: 1,
          name: 'n1',
          posts: {
            // @ts-expect-error: `createMany` is not supported for related objects because `create` accepts an array of related objects
            createMany: {
              data: [
                {
                  id: 1,
                  title: 't1',
                  contents: 'c1',
                },
              ],
            },
          },
        },
      })
    },
    {
      instanceOf: InvalidArgumentError,
      message:
        'Unsupported operation. Currently, only nested `create` operation is supported on create query.',
    }
  )
})

test('update query throws error for unsupported _count argument in select', async (t) => {
  await t.throwsAsync(
    async () => {
      await userTable.update({
        data: {
          name: 'newName',
        },
        where: {
          id: 1,
        },
        select: {
          // @ts-expect-error: Unsupported argument
          _count: true,
        },
      })
    },
    { instanceOf: ZodError }
  )
})

async function createUser1() {
  await userTable.create({
    data: {
      id: 1,
      name: 'name',
    },
  })
}

// Some tests below need to run serially because
// they actually update the DB and there should not be concurrent transactions
// (because SQLite does not have proper isolation
//  between transactions on the same DB connection)
test.serial(
  'update query throws error for unsupported _count argument in include',
  async (t) => {
    await createUser1()

    await t.throwsAsync(
      async () => {
        await userTable.update({
          data: {
            name: 'newName',
          },
          where: {
            id: 1,
          },
          include: {
            // @ts-expect-error: Unsupported argument
            _count: true,
          },
        })
      },
      { instanceOf: ZodError }
    )
  }
)

test.serial(
  'update query throws error when selecting related objects',
  async (t) => {
    await createUser1()

    await t.throwsAsync(
      async () => {
        await userTable.update({
          data: {
            name: 'newName',
          },
          where: {
            id: 1,
          },
          select: {
            name: true,
            // @ts-expect-error: We do not yet support selecting related objects (use include instead)
            posts: {
              take: 5,
            },
          },
        })
      },
      {
        instanceOf: InvalidArgumentError,
        message:
          "Cannot select field posts on table User. Use 'include' to fetch related objects.",
      }
    )
  }
)

test.serial(
  'update query throws error for createMany on related object',
  async (t) => {
    await createUser1()

    await t.throwsAsync(
      async () => {
        await userTable.update({
          data: {
            name: 'n1',
            posts: {
              // @ts-expect-error: `createMany` is not supported for related objects
              createMany: {
                data: [
                  {
                    id: 1,
                    title: 't1',
                    contents: 'c1',
                  },
                ],
              },
            },
          },
          where: {
            id: 1,
          },
        })
      },
      {
        instanceOf: InvalidArgumentError,
        message:
          'Unsupported operation. Currently, only nested `update` and `updateMany` operations are supported on an update query.',
      }
    )
  }
)

test.serial(
  'update query throws error for unsupported increment',
  async (t) => {
    await createUser1()

    await t.throwsAsync(
      async () => {
        await userTable.update({
          data: {
            id: {
              // @ts-expect-error: `increment` operation is not supported for updates
              increment: 3,
            },
            name: 'n1',
          },
          where: {
            id: 1,
          },
        })
      },
      {
        instanceOf: InvalidArgumentError,
        message:
          'Unsupported value {"increment":3} for field "id" in update query.',
      }
    )
  }
)

test('updateMany query throws error for unsupported set operation', async (t) => {
  await t.throwsAsync(
    async () => {
      await userTable.updateMany({
        data: {
          id: {
            // @ts-expect-error: `set` operation is not supported for updateMany
            set: 3,
          },
          name: 'n1',
        },
      })
    },
    {
      instanceOf: InvalidArgumentError,
      message: `Unsupported value {"set":3} for field "id" in update query.`,
    }
  )
})

test('updateMany query throws error for unsupported relational filters', async (t) => {
  const error: ZodError | undefined = await t.throwsAsync(
    async () => {
      await userTable.updateMany({
        data: {
          name: 'n1',
        },
        where: {
          posts: {
            // @ts-expect-error: relational filters are not yet supported
            some: {
              id: 5,
            },
          },
        },
      })
    },
    {
      instanceOf: ZodError,
    }
  )

  if (error) {
    error.issues.some(
      (err) =>
        t.assert(err.code === 'unrecognized_keys') &&
        t.assert(err.message === "Unrecognized key(s) in object: 'some'")
    )
  }
})

test('updateMany query throws error for unsupported query mode', async (t) => {
  const error: ZodError | undefined = await t.throwsAsync(
    async () => {
      await userTable.updateMany({
        data: {
          name: 'n1',
        },
        where: {
          name: {
            // @ts-expect-error: query mode is not supported
            mode: 'insensitive',
          },
        },
      })
    },
    {
      instanceOf: ZodError,
    }
  )

  if (error) {
    error.issues.some(
      (err) =>
        t.assert(err.code === 'unrecognized_keys') &&
        t.assert(err.message === "Unrecognized key(s) in object: 'mode'")
    )
  }
})

test.serial(
  'upsert query throws error when selecting related objects',
  async (t) => {
    await t.throwsAsync(
      async () => {
        await userTable.upsert({
          create: {
            id: 1,
            name: 'user1',
          },
          update: {
            name: 'user1',
          },
          where: {
            id: 1,
          },
          select: {
            name: true,
            // @ts-expect-error: We do not yet support selecting related objects (use include instead)
            posts: {
              take: 5,
            },
          },
        })
      },
      {
        instanceOf: InvalidArgumentError,
        message:
          "Cannot select field posts on table User. Use 'include' to fetch related objects.",
      }
    )
  }
)

test.serial('upsert query throws error when selecting count', async (t) => {
  const err: ZodError | undefined = await t.throwsAsync(
    async () => {
      await userTable.upsert({
        create: {
          id: 1,
          name: 'user1',
        },
        update: {
          name: 'user1',
        },
        where: {
          id: 1,
        },
        select: {
          name: true,
          // @ts-expect-error: selecting _count is not supported yet
          _count: true,
        },
      })
    },
    {
      instanceOf: ZodError,
    }
  )

  if (err)
    err.issues.some(
      (err) =>
        t.assert(err.code === 'unrecognized_keys') &&
        t.assert(err.message === "Unrecognized key(s) in object: '_count'")
    )
})

test.serial('upsert query throws error when including count', async (t) => {
  const err: ZodError | undefined = await t.throwsAsync(
    async () => {
      await userTable.upsert({
        create: {
          id: 1,
          name: 'user1',
        },
        update: {
          name: 'user1',
        },
        where: {
          id: 1,
        },
        include: {
          // @ts-expect-error: including _count is not supported yet
          _count: true,
        },
      })
    },
    {
      instanceOf: ZodError,
    }
  )

  if (err)
    err.issues.some(
      (err) =>
        t.assert(err.code === 'unrecognized_keys') &&
        t.assert(err.message === "Unrecognized key(s) in object: '_count'")
    )
})

test.serial(
  'upsert query throws error for nested connectOrCreate on create argument',
  async (t) => {
    await t.throwsAsync(
      async () => {
        await userTable.upsert({
          create: {
            id: 1,
            name: 'user1',
            posts: {
              // @ts-expect-error: nested connectOrCreate is not supported yet
              connectOrCreate: {
                create: {
                  id: 1,
                  title: 't1',
                  contents: 'c1',
                },
                where: {},
              },
            },
          },
          update: {
            name: 'user1',
          },
          where: {
            id: 1,
          },
        })
      },
      {
        instanceOf: InvalidArgumentError,
        message:
          'Unsupported operation. Currently, only nested `create` operation is supported on create query.',
      }
    )
  }
)

test.serial(
  'upsert query throws error for unsupported multiply operation',
  async (t) => {
    await createUser1()

    await t.throwsAsync(
      async () => {
        await userTable.upsert({
          create: {
            id: 1,
            name: 'user1',
          },
          update: {
            id: {
              // @ts-expect-error: multiply operation is not yet supported
              multiply: 5,
            },
          },
          where: {
            id: 1,
          },
        })
      },
      {
        instanceOf: InvalidArgumentError,
        message:
          'Unsupported value {"multiply":5} for field "id" in update query.',
      }
    )
  }
)

test.serial(
  'upsert query throws error for nested disconnect on update argument',
  async (t) => {
    await createUser1()

    await t.throwsAsync(
      async () => {
        await userTable.upsert({
          create: {
            id: 1,
            name: 'user1',
          },
          update: {
            posts: {
              // @ts-expect-error: disconnect operation is not yet supported
              disconnect: {
                id: 1,
              },
            },
          },
          where: {
            id: 1,
          },
        })
      },
      {
        instanceOf: InvalidArgumentError,
        message:
          'Unsupported operation. Currently, only nested `update` and `updateMany` operations are supported on an update query.',
      }
    )
  }
)

test.serial(
  'delete query throws error when selecting related objects',
  async (t) => {
    await createUser1()

    await t.throwsAsync(
      async () => {
        await userTable.delete({
          select: {
            id: true,
            // @ts-expect-error: We do not yet support selecting related objects (use include instead)
            posts: {
              take: 2,
            },
          },
          where: {
            id: 1,
          },
        })
      },
      {
        instanceOf: InvalidArgumentError,
        message:
          "Cannot select field posts on table User. Use 'include' to fetch related objects.",
      }
    )
  }
)

test.serial('delete query throws error when selecting count', async (t) => {
  await createUser1()

  await t.throwsAsync(
    async () => {
      await userTable.delete({
        select: {
          id: true,
          // @ts-expect-error: selecting _count is not supported yet
          _count: true,
        },
        where: {
          id: 1,
        },
      })
    },
    {
      instanceOf: InvalidArgumentError,
      message:
        "Cannot select field _count on table User. Use 'include' to fetch related objects.",
    }
  )
})

test.serial('delete query throws error when including count', async (t) => {
  await createUser1()

  await t.throwsAsync(
    async () => {
      await userTable.delete({
        include: {
          // @ts-expect-error: including _count is not supported yet
          _count: true,
        },
        where: {
          id: 1,
        },
      })
    },
    {
      instanceOf: InvalidArgumentError,
      message: 'Unexpected field `_count` in `include` argument.',
    }
  )
})

test.serial(
  'deleteMany query throws error for relational filters',
  async (t) => {
    await createUser1()

    const error: ZodError | undefined = await t.throwsAsync(
      async () => {
        await userTable.deleteMany({
          where: {
            posts: {
              // @ts-expect-error: relational filters are not yet supported
              some: {
                id: 5,
              },
            },
          },
        })
      },
      {
        instanceOf: ZodError,
      }
    )

    if (error) {
      error.issues.some(
        (err) =>
          t.assert(err.code === 'unrecognized_keys') &&
          t.assert(err.message === "Unrecognized key(s) in object: 'some'")
      )
    }
  }
)

test.serial(
  'deleteMany query throws error for unsupported query mode',
  async (t) => {
    await createUser1()

    const error: ZodError | undefined = await t.throwsAsync(
      async () => {
        await userTable.deleteMany({
          where: {
            name: {
              // @ts-expect-error: query mode is not supported
              mode: 'insensitive',
            },
          },
        })
      },
      {
        instanceOf: ZodError,
      }
    )

    if (error) {
      error.issues.some(
        (err) =>
          t.assert(err.code === 'unrecognized_keys') &&
          t.assert(err.message === "Unrecognized key(s) in object: 'mode'")
      )
    }
  }
)

test.serial(
  'findUnique query throws error when selecting related objects',
  async (t) => {
    await createUser1()

    await t.throwsAsync(
      async () => {
        await userTable.findUnique({
          select: {
            // @ts-expect-error: We do not yet support selecting related objects (use include instead)
            posts: true,
          },
          where: {
            id: 1,
          },
        })
      },
      {
        instanceOf: InvalidArgumentError,
        message:
          "Cannot select field posts on table User. Use 'include' to fetch related objects.",
      }
    )
  }
)

test.serial(
  'findUnique query throws error for unsupported count in select',
  async (t) => {
    await createUser1()

    await t.throwsAsync(
      async () => {
        await userTable.findUnique({
          select: {
            // @ts-expect-error: count is not yet supported
            _count: true,
          },
          where: {
            id: 1,
          },
        })
      },
      {
        instanceOf: InvalidArgumentError,
        message:
          "Cannot select field _count on table User. Use 'include' to fetch related objects.",
      }
    )
  }
)

test.serial(
  'findUnique query throws error for unsupported count in include',
  async (t) => {
    await createUser1()

    await t.throwsAsync(
      async () => {
        await userTable.findUnique({
          include: {
            // @ts-expect-error: count is not yet supported
            _count: true,
          },
          where: {
            id: 1,
          },
        })
      },
      {
        instanceOf: InvalidArgumentError,
        message: 'Unexpected field `_count` in `include` argument.',
      }
    )
  }
)

test.serial(
  'findMany query throws error when selecting related objects',
  async (t) => {
    await createUser1()

    await t.throwsAsync(
      async () => {
        await userTable.findMany({
          select: {
            // @ts-expect-error: We do not yet support selecting related objects (use include instead)
            posts: true,
          },
        })
      },
      {
        instanceOf: InvalidArgumentError,
        message:
          "Cannot select field posts on table User. Use 'include' to fetch related objects.",
      }
    )
  }
)

test.serial(
  'findMany query throws error for unsupported count in select',
  async (t) => {
    await createUser1()

    await t.throwsAsync(
      async () => {
        await userTable.findMany({
          select: {
            // @ts-expect-error: count is not yet supported
            _count: true,
          },
        })
      },
      {
        instanceOf: InvalidArgumentError,
        message:
          "Cannot select field _count on table User. Use 'include' to fetch related objects.",
      }
    )
  }
)

test.serial(
  'findMany query throws error for unsupported count in include',
  async (t) => {
    await createUser1()

    await t.throwsAsync(
      async () => {
        await userTable.findMany({
          include: {
            // @ts-expect-error: count is not yet supported
            _count: true,
          },
        })
      },
      {
        instanceOf: InvalidArgumentError,
        message: 'Unexpected field `_count` in `include` argument.',
      }
    )
  }
)

test.serial('findMany query throws error for relational filters', async (t) => {
  await createUser1()

  const error: ZodError | undefined = await t.throwsAsync(
    async () => {
      await userTable.findMany({
        where: {
          posts: {
            // @ts-expect-error: relational filters are not yet supported
            some: {
              id: 1,
            },
          },
        },
      })
    },
    {
      instanceOf: ZodError,
    }
  )

  if (error) {
    error.issues.some(
      (err) =>
        t.assert(err.code === 'unrecognized_keys') &&
        t.assert(err.message === "Unrecognized key(s) in object: 'some'")
    )
  }
})

test.serial(
  'findMany query throws error for unsupported query mode',
  async (t) => {
    await createUser1()

    const error: ZodError | undefined = await t.throwsAsync(
      async () => {
        await userTable.findMany({
          where: {
            name: {
              // @ts-expect-error: query mode is not supported
              mode: 'insensitive',
            },
          },
        })
      },
      {
        instanceOf: ZodError,
      }
    )

    if (error) {
      error.issues.some(
        (err) =>
          t.assert(err.code === 'unrecognized_keys') &&
          t.assert(err.message === "Unrecognized key(s) in object: 'mode'")
      )
    }
  }
)

test.serial(
  'findMany query throws error for unsupported count in orderBy argument',
  async (t) => {
    await createUser1()

    await t.throwsAsync(
      async () => {
        await userTable.findMany({
          // @ts-expect-error: ordering by a property of a related object is not yet supported
          orderBy: {
            profile: {
              id: 'asc',
            },
          },
        })
      },
      {
        instanceOf: InvalidArgumentError,
        message:
          "Ordering query results based on the 'profile' related object(s) is not yet supported",
      }
    )
  }
)

//////
//////
//////

test.serial(
  'findFirst query throws error when selecting related objects',
  async (t) => {
    await createUser1()

    await t.throwsAsync(
      async () => {
        await userTable.findFirst({
          select: {
            // @ts-expect-error: We do not yet support selecting related objects (use include instead)
            posts: true,
          },
        })
      },
      {
        instanceOf: InvalidArgumentError,
        message:
          "Cannot select field posts on table User. Use 'include' to fetch related objects.",
      }
    )
  }
)

test.serial(
  'findFirst query throws error for unsupported count in select',
  async (t) => {
    await createUser1()

    await t.throwsAsync(
      async () => {
        await userTable.findFirst({
          select: {
            // @ts-expect-error: count is not yet supported
            _count: true,
          },
        })
      },
      {
        instanceOf: InvalidArgumentError,
        message:
          "Cannot select field _count on table User. Use 'include' to fetch related objects.",
      }
    )
  }
)

test.serial(
  'findFirst query throws error for unsupported count in include',
  async (t) => {
    await createUser1()

    await t.throwsAsync(
      async () => {
        await userTable.findFirst({
          include: {
            // @ts-expect-error: count is not yet supported
            _count: true,
          },
        })
      },
      {
        instanceOf: InvalidArgumentError,
        message: 'Unexpected field `_count` in `include` argument.',
      }
    )
  }
)

test.serial(
  'findFirst query throws error for relational filters',
  async (t) => {
    await createUser1()

    const error: ZodError | undefined = await t.throwsAsync(
      async () => {
        await userTable.findFirst({
          where: {
            posts: {
              // @ts-expect-error: relational filters are not yet supported
              some: {
                id: 1,
              },
            },
          },
        })
      },
      {
        instanceOf: ZodError,
      }
    )

    if (error) {
      error.issues.some(
        (err) =>
          t.assert(err.code === 'unrecognized_keys') &&
          t.assert(err.message === "Unrecognized key(s) in object: 'some'")
      )
    }
  }
)

test.serial(
  'findFirst query throws error for unsupported query mode',
  async (t) => {
    await createUser1()

    const error: ZodError | undefined = await t.throwsAsync(
      async () => {
        await userTable.findFirst({
          where: {
            name: {
              // @ts-expect-error: query mode is not supported
              mode: 'insensitive',
            },
          },
        })
      },
      {
        instanceOf: ZodError,
      }
    )

    if (error) {
      error.issues.some(
        (err) =>
          t.assert(err.code === 'unrecognized_keys') &&
          t.assert(err.message === "Unrecognized key(s) in object: 'mode'")
      )
    }
  }
)

test.serial(
  'findFirst query throws error for unsupported count in orderBy argument',
  async (t) => {
    await createUser1()

    await t.throwsAsync(
      async () => {
        await userTable.findFirst({
          orderBy: [
            {
              name: 'asc',
            },
            // @ts-expect-error: ordering by a property of a related object is not yet supported
            {
              profile: {
                id: 'asc',
              },
            },
          ],
        })
      },
      {
        instanceOf: InvalidArgumentError,
        message:
          "Ordering query results based on the 'profile' related object(s) is not yet supported",
      }
    )
  }
)

// TODO: check why we broke some of the regular tests
