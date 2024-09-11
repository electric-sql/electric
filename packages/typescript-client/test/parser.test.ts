import { describe, expect, it } from 'vitest'
import { MessageParser, defaultParser, pgArrayParser } from '../src/parser'

describe(`Default parser`, () => {
  it(`should parse integers`, () => {
    expect(defaultParser.int2(`0`)).toBe(0)
    expect(defaultParser.int2(`-32768`)).toBe(-32768)
    expect(defaultParser.int2(`32767`)).toBe(32767)

    expect(defaultParser.int4(`0`)).toBe(0)
    expect(defaultParser.int4(`2147483647`)).toBe(2147483647)
    expect(defaultParser.int4(`-2147483648`)).toBe(-2147483648)
  })

  it(`should parse bigints`, () => {
    expect(defaultParser.int8(`-9223372036854775808`)).toBe(
      BigInt(`-9223372036854775808`)
    )
    expect(defaultParser.int8(`9223372036854775807`)).toBe(
      BigInt(`9223372036854775807`)
    )
    expect(defaultParser.int8(`0`)).toBe(BigInt(`0`))
  })

  it(`should parse booleans`, () => {
    expect(defaultParser.bool(`t`)).toBe(true)
    expect(defaultParser.bool(`true`)).toBe(true)
    expect(defaultParser.bool(`false`)).toBe(false)
  })

  it(`should parse float4`, () => {
    expect(defaultParser.float4(`1.1754944e-38`)).toBe(1.1754944e-38)
    expect(defaultParser.float4(`3.4028235e38`)).toBe(3.4028235e38)
    expect(defaultParser.float4(`-3.4028235e38`)).toBe(-3.4028235e38)
    expect(defaultParser.float4(`-1.1754944e-38`)).toBe(-1.1754944e-38)
    expect(defaultParser.float4(`0`)).toBe(0)
    expect(defaultParser.float4(`Infinity`)).toBe(Infinity)
    expect(defaultParser.float4(`-Infinity`)).toBe(-Infinity)
    expect(defaultParser.float4(`NaN`)).toBe(NaN)
  })

  it(`should parse float8`, () => {
    expect(defaultParser.float8(`1.797e308`)).toBe(1.797e308)
    expect(defaultParser.float8(`-1.797e+308`)).toBe(-1.797e308)
    expect(defaultParser.float8(`0`)).toBe(0)
    expect(defaultParser.float8(`Infinity`)).toBe(Infinity)
    expect(defaultParser.float8(`-Infinity`)).toBe(-Infinity)
    expect(defaultParser.float8(`NaN`)).toBe(NaN)
  })

  it(`should parse json`, () => {
    expect(defaultParser.json(`true`)).toEqual(true)
    expect(defaultParser.json(`5`)).toEqual(5)
    expect(defaultParser.json(`"foo"`)).toEqual(`foo`)
    expect(defaultParser.json(`{}`)).toEqual({})
    expect(defaultParser.json(`null`)).toEqual(null)
    expect(defaultParser.json(`{"a":null}`)).toEqual({ a: null })
    expect(defaultParser.json(`[]`)).toEqual([])
    expect(defaultParser.json(`{"a":1}`)).toEqual({ a: 1 })
    expect(defaultParser.json(`{"a":1,"b":2}`)).toEqual({ a: 1, b: 2 })
    expect(defaultParser.json(`[{"a":1,"b":2},{"c": [{"d": 5}]}]`)).toEqual([
      { a: 1, b: 2 },
      { c: [{ d: 5 }] },
    ])

    expect(defaultParser.jsonb(`true`)).toEqual(true)
    expect(defaultParser.jsonb(`5`)).toEqual(5)
    expect(defaultParser.jsonb(`"foo"`)).toEqual(`foo`)
    expect(defaultParser.jsonb(`{}`)).toEqual({})
    expect(defaultParser.jsonb(`null`)).toEqual(null)
    expect(defaultParser.json(`{"a":null}`)).toEqual({ a: null })
    expect(defaultParser.jsonb(`[]`)).toEqual([])
    expect(defaultParser.jsonb(`{"a":1}`)).toEqual({ a: 1 })
    expect(defaultParser.jsonb(`{"a":1,"b":2}`)).toEqual({ a: 1, b: 2 })
    expect(defaultParser.jsonb(`[{"a":1,"b":2},{"c": [{"d": 5}]}]`)).toEqual([
      { a: 1, b: 2 },
      { c: [{ d: 5 }] },
    ])
  })
})

describe(`Postgres array parser`, () => {
  it(`should parse arrays and their values`, () => {
    expect(pgArrayParser(`{1,2,3,4,5}`, defaultParser.int2)).toEqual([
      1, 2, 3, 4, 5,
    ])
    expect(pgArrayParser(`{1,2,3,4,5}`, defaultParser.int8)).toEqual([
      BigInt(1),
      BigInt(2),
      BigInt(3),
      BigInt(4),
      BigInt(5),
    ])
    expect(pgArrayParser(`{"foo","bar"}`, (v) => v)).toEqual([`foo`, `bar`])
    expect(pgArrayParser(`{foo,"}"}`, (v) => v)).toEqual([`foo`, `}`])
    expect(pgArrayParser(`{t,f,f}`, defaultParser.bool)).toEqual([
      true,
      false,
      false,
    ])

    expect(pgArrayParser(`{}`, defaultParser.json)).toEqual([])
    expect(pgArrayParser(`{"{}"}`, defaultParser.json)).toEqual([{}])
    expect(pgArrayParser(`{null}`, defaultParser.json)).toEqual([null])
    // eslint-disable-next-line no-useless-escape -- The backslashes are not useless, they are required in Postgres wire format
    expect(pgArrayParser(`{"{\\\"a\\\":null}"}`, defaultParser.json)).toEqual([
      { a: null },
    ])

    expect(
      pgArrayParser(`{Infinity,-Infinity,NaN}`, defaultParser.float8)
    ).toEqual([Infinity, -Infinity, NaN])
  })

  it(`should parse nested arrays`, () => {
    expect(pgArrayParser(`{{1,2},{3,4}}`, defaultParser.int2)).toEqual([
      [1, 2],
      [3, 4],
    ])
    expect(pgArrayParser(`{{"foo"},{"bar"}}`, (v) => v)).toEqual([
      [`foo`],
      [`bar`],
    ])
    expect(pgArrayParser(`{{t,f}, {f,t}}`, defaultParser.bool)).toEqual([
      [true, false],
      [false, true],
    ])
    expect(pgArrayParser(`{{1,2},{3,4}}`, defaultParser.int8)).toEqual([
      [BigInt(1), BigInt(2)],
      [BigInt(3), BigInt(4)],
    ])

    expect(pgArrayParser(`{{},{}}`, defaultParser.json)).toEqual([[], []])
    expect(pgArrayParser(`{"{}","{}"}`, defaultParser.json)).toEqual([{}, {}])
    expect(pgArrayParser(`{null,null}`, defaultParser.json)).toEqual([
      null,
      null,
    ])
    expect(
      pgArrayParser(
        // eslint-disable-next-line no-useless-escape -- The backslashes are not useless, they are required in Postgres wire format
        `{"{\\\"a\\\":null}", "{\\\"b\\\":null}"}`,
        defaultParser.json
      )
    ).toEqual([{ a: null }, { b: null }])

    expect(
      pgArrayParser(
        `{{Infinity,-Infinity,NaN},{NaN,Infinity,-Infinity}}`,
        defaultParser.float8
      )
    ).toEqual([
      [Infinity, -Infinity, NaN],
      [NaN, Infinity, -Infinity],
    ])
  })
})

describe(`Message parser`, () => {
  const parser = new MessageParser()

  it(`should parse null values`, () => {
    const messages = `[ { "value": { "a": null } } ]`
    const expectedParsedMessages = [{ value: { a: null } }]

    const sampleDims = [undefined, 1, 2]

    for (const dims of sampleDims) {
      // If it's not nullable it should throw
      expect(() =>
        parser.parse(messages, { a: { type: `int2`, dims, not_null: true } })
      ).toThrowError(`Column a is not nullable`)

      // Otherwise, it should parse as null
      expect(parser.parse(messages, { a: { type: `int2`, dims } })).toEqual(
        expectedParsedMessages
      )
      expect(parser.parse(messages, { a: { type: `int4`, dims } })).toEqual(
        expectedParsedMessages
      )
      expect(parser.parse(messages, { a: { type: `int8`, dims } })).toEqual(
        expectedParsedMessages
      )
      expect(parser.parse(messages, { a: { type: `bool`, dims } })).toEqual(
        expectedParsedMessages
      )
      expect(parser.parse(messages, { a: { type: `float4`, dims } })).toEqual(
        expectedParsedMessages
      )
      expect(parser.parse(messages, { a: { type: `float8`, dims } })).toEqual(
        expectedParsedMessages
      )
      expect(parser.parse(messages, { a: { type: `json`, dims } })).toEqual(
        expectedParsedMessages
      )
      expect(parser.parse(messages, { a: { type: `jsonb`, dims } })).toEqual(
        expectedParsedMessages
      )
      expect(parser.parse(messages, { a: { type: `text`, dims } })).toEqual(
        expectedParsedMessages
      )
    }
  })

  it(`should parse arrays including null values`, () => {
    const schema = {
      a: { type: `int2`, dims: 1 },
    }

    expect(
      parser.parse(`[ { "value": { "a": "{1,2,NULL,4,5}" } } ]`, schema)
    ).toEqual([{ value: { a: [1, 2, null, 4, 5] } }])
  })

  it(`should parse null value on column named value`, () => {
    const schema = {
      a: { type: `text`, dims: 1 },
    }

    expect(parser.parse(`[ { "value": null } ]`, schema)).toEqual([
      { value: null },
    ])
  })
})
