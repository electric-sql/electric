import * as z from 'zod'
declare type isAny<T> = [any extends T ? 'true' : 'false'] extends ['true']
  ? true
  : false
declare type equals<X, Y> = [X] extends [Y]
  ? [Y] extends [X]
    ? true
    : false
  : false

type MakeNullish<T> = z.ZodOptional<
  z.ZodNullable<toZod<Exclude<T, undefined | null>>>
>

type isNullish<T> = null extends T
  ? undefined extends T
    ? true
    : false
  : false

// Extension of `toZod` to handle nullish values
// see https://github.com/colinhacks/tozod/issues/19
export declare type toZod<T> = isAny<T> extends true
  ? never
  : [T] extends [boolean]
  ? z.ZodBoolean
  : isNullish<T> extends true
  ? MakeNullish<T>
  : [undefined] extends [T]
  ? T extends undefined
    ? never
    : z.ZodOptional<toZod<T>>
  : [null] extends [T]
  ? T extends null
    ? never
    : z.ZodNullable<toZod<T>>
  : T extends Array<infer U>
  ? z.ZodArray<toZod<U>>
  : T extends Promise<infer U>
  ? z.ZodPromise<toZod<U>>
  : equals<T, string> extends true
  ? z.ZodString
  : equals<T, bigint> extends true
  ? z.ZodBigInt
  : equals<T, number> extends true
  ? z.ZodNumber
  : equals<T, Date> extends true
  ? z.ZodDate
  : T extends {
      [k: string]: any
    }
  ? z.ZodObject<
      {
        [k in keyof T]-?: toZod<T[k]>
      },
      'strip',
      z.ZodTypeAny,
      T,
      T
    >
  : never
