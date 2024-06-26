import { TestFn } from 'ava'
import { JsonNull } from '../generated'
import {
  Dialect,
  QueryBuilder,
} from '../../../src/migrators/query-builder/builder'
import { DbSchema, ElectricClient } from '../../../src/client/model'
import { Converter } from '../../../src/client/conversions/converter'
import { PgBasicType, PgDateType } from '../../../src/client/conversions/types'

export type ContextType = {
  electric: ElectricClient<DbSchema<any>>
  builder: QueryBuilder
  converter: Converter
  dialect: Dialect
}

/*
 * The tests below check that advanced data types
 * can be written into the DB, thereby, testing that
 * JS objects can be transformed to SQLite compatible values on writes
 * and then be converted back to JS objects on reads.
 */

export const datatypeTests = (test: TestFn<ContextType>) => {
  test('support date type', async (t) => {
    const { electric, builder, converter } = t.context
    const date = '2023-08-07'
    const d = new Date(`${date} 23:28:35.421`)
    const encodedDate = converter.encode(d, PgDateType.PG_DATE)

    await electric.adapter.run({
      sql: `INSERT INTO "DataTypes"("id", "date") VALUES(1, ${builder.makePositionalParam(
        1
      )});`,
      args: [encodedDate],
    })

    const expectedDate = new Date(date)

    const res = await electric.db.rawQuery({
      sql: `SELECT "date" FROM "DataTypes" WHERE "id" = 1;`,
    })

    t.is(res.length, 1)

    const decodedRes = converter.decode(res[0].date, PgDateType.PG_DATE)
    t.deepEqual(decodedRes, expectedDate)
  })

  test('support date type created without specified time', async (t) => {
    const { electric, builder, converter } = t.context

    const date = new Date('2023-08-07')

    await electric.adapter.run({
      sql: `INSERT INTO "DataTypes"("id", "date") VALUES(1, ${builder.makePositionalParam(
        1
      )});`,
      args: [converter.encode(date, PgDateType.PG_DATE)],
    })

    const res = await electric.db.rawQuery({
      sql: `SELECT "date" FROM "DataTypes" WHERE "id" = 1;`,
    })

    t.is(res.length, 1)
    const decodedRes = converter.decode(res[0].date, PgDateType.PG_DATE)
    t.deepEqual(decodedRes, date)
  })

  test('support time type', async (t) => {
    const { electric, builder, converter } = t.context
    const date = new Date('2023-08-07 18:28:35.421')

    await electric.adapter.run({
      sql: `INSERT INTO "DataTypes"("id", "time") VALUES(1, ${builder.makePositionalParam(
        1
      )});`,
      args: [converter.encode(date, PgDateType.PG_TIME)],
    })

    const res = await electric.db.rawQuery({
      sql: `SELECT "time" FROM "DataTypes" WHERE "id" = 1;`,
    })

    t.is(res.length, 1)

    const decodedRes = converter.decode(res[0].time, PgDateType.PG_TIME)
    t.deepEqual(decodedRes, new Date('1970-01-01 18:28:35.421'))
  })

  test('support timetz type', async (t) => {
    const { electric, builder, converter } = t.context
    // Check that we store the time without taking into account timezones
    // such that upon reading we get the same time even if we are in a different time zone
    // test with 2 different time zones such that they cannot both coincide with the machine's timezone.
    const date1 = new Date('2023-08-07 18:28:35.421+02')
    const date2 = new Date('2023-08-07 18:28:35.421+03')

    await electric.adapter.run({
      sql: `INSERT INTO "DataTypes"("id", "timetz") VALUES(1, ${builder.makePositionalParam(
        1
      )}), (2, ${builder.makePositionalParam(2)});`,
      args: [
        converter.encode(date1, PgDateType.PG_TIMETZ),
        converter.encode(date2, PgDateType.PG_TIMETZ),
      ],
    })

    const res = await electric.db.rawQuery({
      sql: `SELECT "id", "timetz" FROM "DataTypes" ORDER BY "id" ASC;`,
    })

    const decodedRes = res.map((row) => ({
      ...row,
      timetz: converter.decode(row.timetz, PgDateType.PG_TIMETZ),
    }))

    t.is(decodedRes.length, 2)
    t.deepEqual(decodedRes, [
      {
        id: 1,
        timetz: new Date('1970-01-01 18:28:35.421+02'),
      },
      {
        id: 2,
        timetz: new Date('1970-01-01 18:28:35.421+03'),
      },
    ])
  })

  test('support timestamp type', async (t) => {
    const { electric, builder, converter } = t.context
    const date = new Date('2023-08-07 18:28:35.421')

    await electric.adapter.run({
      sql: `INSERT INTO "DataTypes"("id", "timestamp") VALUES(1, ${builder.makePositionalParam(
        1
      )});`,
      args: [converter.encode(date, PgDateType.PG_TIMESTAMP)],
    })

    const res = await electric.db.rawQuery({
      sql: `SELECT "timestamp" FROM "DataTypes"`,
    })

    t.is(res.length, 1)

    const decodedRes = converter.decode(
      res[0].timestamp,
      PgDateType.PG_TIMESTAMP
    )
    t.deepEqual(decodedRes, new Date('2023-08-07 18:28:35.421'))
  })

  test('support timestamp type - input date with offset', async (t) => {
    const { electric, builder, converter } = t.context
    const date = new Date('2023-08-07 18:28:35.421+05')

    await electric.adapter.run({
      sql: `INSERT INTO "DataTypes"("id", "timestamp") VALUES(1, ${builder.makePositionalParam(
        1
      )});`,
      args: [converter.encode(date, PgDateType.PG_TIMESTAMP)],
    })

    const res = await electric.db.rawQuery({
      sql: `SELECT "timestamp" FROM "DataTypes"`,
    })

    t.is(res.length, 1)

    const decodedRes = converter.decode(
      res[0].timestamp,
      PgDateType.PG_TIMESTAMP
    )
    t.deepEqual(decodedRes, date)
  })

  test('support timestamptz type', async (t) => {
    const { electric, builder, converter } = t.context
    // Check that we store the timestamp without taking into account timezones
    // such that upon reading we get the same timestamp even if we are in a different time zone
    // test with 2 different time zones such that they cannot both coincide with the machine's timezone.
    const date1 = new Date('2023-08-07 18:28:35.421+02')
    const date2 = new Date('2023-08-07 18:28:35.421+03')

    await electric.adapter.run({
      sql: `INSERT INTO "DataTypes"("id", "timestamptz") VALUES(1, ${builder.makePositionalParam(
        1
      )}), (2, ${builder.makePositionalParam(2)});`,
      args: [
        converter.encode(date1, PgDateType.PG_TIMESTAMPTZ),
        converter.encode(date2, PgDateType.PG_TIMESTAMPTZ),
      ],
    })

    const res = await electric.db.rawQuery({
      sql: `SELECT "id", "timestamptz" FROM "DataTypes" ORDER BY "id" ASC;`,
    })
    const decodedRes = res.map((row) => ({
      ...row,
      timestamptz: converter.decode(row.timestamptz, PgDateType.PG_TIMESTAMPTZ),
    }))

    t.is(decodedRes.length, 2)
    t.deepEqual(decodedRes, [
      {
        id: 1,
        timestamptz: date1,
      },
      {
        id: 2,
        timestamptz: date2,
      },
    ])
  })

  test('support null value for timestamptz type', async (t) => {
    const { electric, builder, converter } = t.context

    await electric.adapter.run({
      sql: `INSERT INTO "DataTypes"("id", "timestamptz") VALUES(1, ${builder.makePositionalParam(
        1
      )});`,
      args: [converter.encode(null, PgDateType.PG_TIMESTAMPTZ)],
    })

    const res = await electric.db.rawQuery({
      sql: `SELECT "timestamptz" FROM "DataTypes" WHERE "id" = 1;`,
    })

    t.is(res.length, 1)

    const decodedRes = converter.decode(
      res[0].timestamptz,
      PgDateType.PG_TIMESTAMPTZ
    )
    t.deepEqual(decodedRes, null)
  })

  test('support boolean type', async (t) => {
    const { electric, builder, converter } = t.context
    // Check that we can store booleans
    await electric.adapter.run({
      sql: `INSERT INTO "DataTypes"("id", "bool") VALUES(1, ${builder.makePositionalParam(
        1
      )}), (2, ${builder.makePositionalParam(2)});`,
      args: [
        converter.encode(true, PgBasicType.PG_BOOL),
        converter.encode(false, PgBasicType.PG_BOOL),
      ],
    })

    const res = await electric.db.rawQuery({
      sql: `SELECT "id", "bool" FROM "DataTypes" ORDER BY "id" ASC;`,
    })
    const decodedRes = res.map((row) => ({
      ...row,
      bool: converter.decode(row.bool, PgBasicType.PG_BOOL),
    }))

    t.is(decodedRes.length, 2)
    t.deepEqual(decodedRes, [
      {
        id: 1,
        bool: true,
      },
      {
        id: 2,
        bool: false,
      },
    ])

    // FIXME: re-introduce the check below when the converter checks validity of the the input value
    // Check that it rejects invalid values
    /*
    await t.throwsAsync(
      tbl.create({
        data: {
          id: 3,
          // @ts-expect-error inserting a string as a boolean
          bool: 'true',
        },
      }),
      {
        instanceOf: ZodError,
        message: /Expected boolean, received string/,
      }
    )
    */
  })

  test('support null value for boolean type', async (t) => {
    const { electric, builder, converter } = t.context

    await electric.adapter.run({
      sql: `INSERT INTO "DataTypes"("id", "bool") VALUES(1, ${builder.makePositionalParam(
        1
      )});`,
      args: [converter.encode(null, PgBasicType.PG_BOOL)],
    })

    const res = await electric.db.rawQuery({
      sql: `SELECT "bool" FROM "DataTypes"`,
    })

    t.is(res.length, 1)
    const decodedRes = converter.decode(res[0].bool, PgBasicType.PG_BOOL)
    t.is(decodedRes, null)
  })

  test('support uuid type', async (t) => {
    const { electric, builder, converter } = t.context
    const uuid = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

    await electric.adapter.run({
      sql: `INSERT INTO "DataTypes"("id", "uuid") VALUES(1, ${builder.makePositionalParam(
        1
      )});`,
      args: [converter.encode(uuid, PgBasicType.PG_UUID)],
    })

    const res = await electric.db.rawQuery({
      sql: `SELECT "uuid" FROM "DataTypes" WHERE "id" = 1;`,
    })

    t.is(res.length, 1)
    t.is(res[0].uuid, uuid)

    // FIXME: re-introduce the check below when the converter checks validity of the the input value
    // Check that it rejects invalid uuids
    /*
    await t.throwsAsync(
      tbl.create({
        data: {
          id: 2,
          // the UUID below has 1 character too much in the last group
          uuid: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a111',
        },
      }),
      {
        instanceOf: ZodError,
        message: /Invalid uuid/,
      }
    )
    */
  })

  test('support null value for uuid type', async (t) => {
    const { electric, builder, converter } = t.context

    await electric.adapter.run({
      sql: `INSERT INTO "DataTypes"("id", "uuid") VALUES(1, ${builder.makePositionalParam(
        1
      )});`,
      args: [converter.encode(null, PgBasicType.PG_UUID)],
    })

    const res = await electric.db.rawQuery({
      sql: `SELECT "uuid" FROM "DataTypes" WHERE "id" = 1;`,
    })

    t.is(res.length, 1)
    t.is(res[0].uuid, null)
  })

  test('support int2 type', async (t) => {
    const { electric, builder, converter } = t.context

    const validInt1 = 32767
    const validInt2 = -32768

    await electric.adapter.run({
      sql: `INSERT INTO "DataTypes"("id", "int2") VALUES(1, ${builder.makePositionalParam(
        1
      )}), (2, ${builder.makePositionalParam(2)});`,
      args: [
        converter.encode(validInt1, PgBasicType.PG_INT2),
        converter.encode(validInt2, PgBasicType.PG_INT2),
      ],
    })

    const res = await electric.db.rawQuery({
      sql: `SELECT "id", "int2" FROM "DataTypes" ORDER BY "id" ASC;`,
    })

    t.is(res.length, 2)
    t.deepEqual(res, [
      {
        id: 1,
        int2: validInt1,
      },
      {
        id: 2,
        int2: validInt2,
      },
    ])

    // FIXME: re-introduce the check below when the converter checks validity of the the input value
    // Check that it rejects invalid integers
    /*
    const invalidInt1 = 32768
    const invalidInt2 = -32769
    const invalidInts = [invalidInt1, invalidInt2]
    let id = 3
    for (const invalidInt of invalidInts) {
      await t.throwsAsync(
        tbl.create({
          data: {
            id: id++,
            int2: invalidInt,
          },
        }),
        {
          instanceOf: ZodError,
          message:
            /(Number must be less than or equal to 32767)|(Number must be greater than or equal to -32768)/,
        }
      )
    }
    */
  })

  test('support null values for int2 type', async (t) => {
    const { electric, builder, converter } = t.context

    await electric.adapter.run({
      sql: `INSERT INTO "DataTypes"("id", "int2") VALUES(1, ${builder.makePositionalParam(
        1
      )});`,
      args: [converter.encode(null, PgBasicType.PG_INT2)],
    })

    const res = await electric.db.rawQuery({
      sql: `SELECT "int2" FROM "DataTypes" WHERE "id" = 1;`,
    })

    t.is(res.length, 1)
    t.is(res[0].int2, null)
  })

  test('support int4 type', async (t) => {
    const { electric, builder, converter } = t.context

    const validInt1 = 2147483647
    const validInt2 = -2147483648

    await electric.adapter.run({
      sql: `INSERT INTO "DataTypes"("id", "int4") VALUES(1, ${builder.makePositionalParam(
        1
      )}), (2, ${builder.makePositionalParam(2)});`,
      args: [
        converter.encode(validInt1, PgBasicType.PG_INT4),
        converter.encode(validInt2, PgBasicType.PG_INT4),
      ],
    })

    const res = await electric.db.rawQuery({
      sql: `SELECT "id", "int4" FROM "DataTypes" ORDER BY "id" ASC;`,
    })

    t.is(res.length, 2)
    t.deepEqual(res, [
      {
        id: 1,
        int4: validInt1,
      },
      {
        id: 2,
        int4: validInt2,
      },
    ])

    // FIXME: re-introduce the check below when the converter checks validity of the the input value
    // Check that it rejects invalid integers
    /*
    const invalidInt1 = 2147483648
    const invalidInt2 = -2147483649
    const invalidInts = [invalidInt1, invalidInt2]
    let id = 3
    for (const invalidInt of invalidInts) {
      await t.throwsAsync(
        tbl.create({
          data: {
            id: id++,
            int4: invalidInt,
          },
        }),
        {
          instanceOf: ZodError,
          message:
            /(Number must be less than or equal to 2147483647)|(Number must be greater than or equal to -2147483648)/,
        }
      )
    }
    */
  })

  test('support null values for int4 type', async (t) => {
    const { electric, builder, converter } = t.context

    await electric.adapter.run({
      sql: `INSERT INTO "DataTypes"("id", "int4") VALUES(1, ${builder.makePositionalParam(
        1
      )});`,
      args: [converter.encode(null, PgBasicType.PG_INT4)],
    })

    const res = await electric.db.rawQuery({
      sql: `SELECT "int4" FROM "DataTypes" WHERE "id" = 1;`,
    })

    t.is(res.length, 1)
    t.is(res[0].int4, null)
  })

  test('support float4 type', async (t) => {
    const { electric, builder, converter } = t.context
    const validFloat1 = 1.402823e36
    const validFloat2 = -1.402823e36
    const floats = [
      {
        id: 1,
        float4: validFloat1,
      },
      {
        id: 2,
        float4: validFloat2,
      },
      {
        id: 3,
        float4: +Infinity,
      },
      {
        id: 4,
        float4: -Infinity,
      },
      {
        id: 5,
        float4: NaN,
      },
    ]

    await electric.adapter.run({
      sql: `INSERT INTO "DataTypes"("id", "float4") VALUES(1, ${builder.makePositionalParam(
        1
      )}), (2, ${builder.makePositionalParam(
        2
      )}), (3, ${builder.makePositionalParam(
        3
      )}), (4, ${builder.makePositionalParam(
        4
      )}), (5, ${builder.makePositionalParam(5)});`,
      args: floats.map((row) =>
        converter.encode(row.float4, PgBasicType.PG_FLOAT4)
      ),
    })

    // Check that we can read the floats back
    const res = (await electric.db.rawQuery({
      sql: `SELECT "id", "float4" FROM "DataTypes" ORDER BY "id" ASC;`,
    })) as Array<{ id: number; float4?: number }>

    t.deepEqual(
      res.map((o) => ({ ...o, float4: Math.fround(o.float4!) })),
      floats.map((o) => ({ ...o, float4: Math.fround(o.float4) }))
    )
  })

  test('converts numbers outside float4 range', async (t) => {
    const { electric, builder, converter } = t.context
    const tooPositive = 2 ** 150
    const tooNegative = -(2 ** 150)
    const tooSmallPositive = 2 ** -150
    const tooSmallNegative = -(2 ** -150)
    const floats = [
      {
        id: 1,
        float4: tooPositive,
      },
      {
        id: 2,
        float4: tooNegative,
      },
      {
        id: 3,
        float4: tooSmallPositive,
      },
      {
        id: 4,
        float4: tooSmallNegative,
      },
    ]

    await electric.adapter.run({
      sql: `INSERT INTO "DataTypes"("id", "float4") VALUES(1, ${builder.makePositionalParam(
        1
      )}), (2, ${builder.makePositionalParam(
        2
      )}), (3, ${builder.makePositionalParam(
        3
      )}), (4, ${builder.makePositionalParam(4)});`,
      args: floats.map((row) =>
        converter.encode(row.float4, PgBasicType.PG_FLOAT4)
      ),
    })

    // Check that we can read the floats back
    const res = await electric.db.rawQuery({
      sql: `SELECT "id", "float4" FROM "DataTypes" ORDER BY "id" ASC;`,
    })

    t.deepEqual(res, [
      {
        id: 1,
        float4: Infinity,
      },
      {
        id: 2,
        float4: -Infinity,
      },
      {
        id: 3,
        float4: 0,
      },
      {
        id: 4,
        float4: 0,
      },
    ])
  })

  test('support float8 type', async (t) => {
    const { electric, builder, converter } = t.context
    const validFloat1 = 1.7976931348623157e308
    const validFloat2 = -1.7976931348623157e308
    const floats = [
      {
        id: 1,
        float8: validFloat1,
      },
      {
        id: 2,
        float8: validFloat2,
      },
      {
        id: 3,
        float8: +Infinity,
      },
      {
        id: 4,
        float8: -Infinity,
      },
      {
        id: 5,
        float8: NaN,
      },
    ]

    await electric.adapter.run({
      sql: `INSERT INTO "DataTypes"("id", "float8") VALUES(1, ${builder.makePositionalParam(
        1
      )}), (2, ${builder.makePositionalParam(
        2
      )}), (3, ${builder.makePositionalParam(
        3
      )}), (4, ${builder.makePositionalParam(
        4
      )}), (5, ${builder.makePositionalParam(5)});`,
      args: floats.map((row) =>
        converter.encode(row.float8, PgBasicType.PG_FLOAT8)
      ),
    })

    // Check that we can read the floats back
    const res = await electric.db.rawQuery({
      sql: `SELECT "id", "float8" FROM "DataTypes" ORDER BY "id" ASC;`,
    })
    const decodedRes = res.map((row) => ({
      ...row,
      float8: converter.decode(row.float8, PgBasicType.PG_FLOAT8),
    }))

    t.deepEqual(decodedRes, floats)
  })

  test('support null values for float8 type', async (t) => {
    const { electric, builder, converter } = t.context

    await electric.adapter.run({
      sql: `INSERT INTO "DataTypes"("id", "float8") VALUES(1, ${builder.makePositionalParam(
        1
      )});`,
      args: [converter.encode(null, PgBasicType.PG_FLOAT8)],
    })

    const res = await electric.db.rawQuery({
      sql: `SELECT "float8" FROM "DataTypes" WHERE "id" = 1;`,
    })

    t.is(res.length, 1)
    const decodedRes = converter.decode(res[0].float8, PgBasicType.PG_FLOAT8)
    t.deepEqual(decodedRes, null)
  })

  test('support BigInt type', async (t) => {
    const { electric, builder, converter } = t.context
    //db.defaultSafeIntegers(true) // enables BigInt support
    const validBigInt1 = BigInt('9223372036854775807')
    const validBigInt2 = BigInt('-9223372036854775808')
    const bigInts = [
      {
        id: 1,
        int8: validBigInt1,
      },
      {
        id: 2,
        int8: validBigInt2,
      },
    ]

    await electric.adapter.run({
      sql: `INSERT INTO "DataTypes"("id", "int8") VALUES(1, ${builder.makePositionalParam(
        1
      )}), (2, ${builder.makePositionalParam(2)});`,
      args: bigInts.map((row) =>
        converter.encode(row.int8, PgBasicType.PG_INT8)
      ),
    })

    // Check that we can read the big ints back
    // need to cast the column to TEXT because otherwise it is read as a regular JS number
    // but it doesn't fit the JS number range
    // so we cast it to TEXT and let `converter.decode` decode it into a BigInt
    const res = await electric.db.rawQuery({
      sql: `SELECT "id", cast("int8" AS TEXT) AS "int8" FROM "DataTypes" ORDER BY "id" ASC;`,
    })
    const decodedRes = res.map((row) => ({
      ...row,
      int8: converter.decode(row.int8, PgBasicType.PG_INT8),
    }))

    t.deepEqual(decodedRes, bigInts)
    //db.defaultSafeIntegers(false) // disables BigInt support
  })

  test('support null values for BigInt type', async (t) => {
    const { electric, builder, converter } = t.context

    await electric.adapter.run({
      sql: `INSERT INTO "DataTypes"("id", "int8") VALUES(1, ${builder.makePositionalParam(
        1
      )});`,
      args: [converter.encode(null, PgBasicType.PG_INT8)],
    })

    const res = await electric.db.rawQuery({
      sql: `SELECT "int8" FROM "DataTypes" WHERE "id" = 1;`,
    })

    t.is(res.length, 1)
    const decodedRes = converter.decode(res[0].int8, PgBasicType.PG_INT8)
    t.deepEqual(decodedRes, null)
  })

  // FIXME: re-introduce the test below when the converter checks validity of the input value
  /*
  test('throw error when value is out of range for BigInt type', async (t) => {
    const { tbl } = t.context
    const invalidBigInt1 = BigInt('9223372036854775808')
    const invalidBigInt2 = BigInt('-9223372036854775809')

    await t.throwsAsync(
      tbl.create({
        data: {
          id: 1,
          int8: invalidBigInt1,
        },
      }),
      {
        instanceOf: ZodError,
        message: /BigInt must be less than or equal to 9223372036854775807/,
      }
    )

    await t.throwsAsync(
      tbl.create({
        data: {
          id: 2,
          int8: invalidBigInt2,
        },
      }),
      {
        instanceOf: ZodError,
        message: /too_small/,
      }
    )
  })
  */

  test('support JSONB type', async (t) => {
    const { electric, builder, converter, dialect } = t.context
    const json = { a: 1, b: true, c: { d: 'nested' }, e: [1, 2, 3], f: null }

    await electric.adapter.run({
      sql: `INSERT INTO "DataTypes"("id", "json") VALUES(1, ${builder.makePositionalParam(
        1
      )});`,
      args: [converter.encode(json, PgBasicType.PG_JSONB)],
    })

    const res = await electric.db.rawQuery({
      sql: `SELECT "json" FROM "DataTypes" WHERE "id" = 1;`,
    })

    t.is(res.length, 1)
    const decodedRes = converter.decode(res[0].json, PgBasicType.PG_JSONB)
    t.deepEqual(decodedRes, json)

    // Also test that we can write the special JsonNull value
    await electric.adapter.run({
      sql: `INSERT INTO "DataTypes"("id", "json") VALUES(2, ${builder.makePositionalParam(
        1
      )});`,
      args: [converter.encode(JsonNull, PgBasicType.PG_JSONB)],
    })

    const res2 = await electric.db.rawQuery({
      sql: `SELECT "json" FROM "DataTypes" WHERE "id" = 2;`,
    })

    // Currently can't store top-level JSON null values when using PG
    // they are automatically transformed to DB NULL
    t.is(res2.length, 1)
    const decodedRes2 = converter.decode(res2[0].json, PgBasicType.PG_JSONB)
    t.deepEqual(decodedRes2, dialect === 'SQLite' ? JsonNull : null)
  })

  test('support null values for JSONB type', async (t) => {
    const { electric, builder, converter } = t.context

    await electric.adapter.run({
      sql: `INSERT INTO "DataTypes"("id", "json") VALUES(1, ${builder.makePositionalParam(
        1
      )});`,
      args: [converter.encode(null, PgBasicType.PG_JSONB)],
    })

    const res = await electric.db.rawQuery({
      sql: `SELECT "json" FROM "DataTypes" WHERE "id" = 1;`,
    })

    t.is(res.length, 1)
    const decodedRes = converter.decode(res[0].json, PgBasicType.PG_JSONB)
    t.is(decodedRes, null)
  })

  test('support BLOB type', async (t) => {
    const { electric, builder, converter } = t.context
    const blob = new Uint8Array([1, 2, 3, 4, 5])

    await electric.adapter.run({
      sql: `INSERT INTO "DataTypes"("id", "bytea") VALUES(1, ${builder.makePositionalParam(
        1
      )});`,
      args: [converter.encode(blob, PgBasicType.PG_BYTEA)],
    })

    const res = await electric.db.rawQuery({
      sql: `SELECT "bytea" FROM "DataTypes" WHERE "id" = 1;`,
    })

    t.is(res.length, 1)
    const decodedRes = converter.decode(res[0].bytea, PgBasicType.PG_BYTEA)
    // Need to wrap it into `Uint8Array` because postgres returns a buffer
    // which is an instance of Uint8Array but is not deeply equal to it
    t.deepEqual(new Uint8Array(decodedRes), blob)
  })

  test('support null values for BLOB type', async (t) => {
    const { electric, builder, converter } = t.context

    await electric.adapter.run({
      sql: `INSERT INTO "DataTypes"("id", "bytea") VALUES(1, ${builder.makePositionalParam(
        1
      )});`,
      args: [converter.encode(null, PgBasicType.PG_BYTEA)],
    })

    const res = await electric.db.rawQuery({
      sql: `SELECT "bytea" FROM "DataTypes" WHERE "id" = 1;`,
    })

    t.is(res.length, 1)
    const decodedRes = converter.decode(res[0].bytea, PgBasicType.PG_BYTEA)
    t.deepEqual(decodedRes, null)
  })
}
