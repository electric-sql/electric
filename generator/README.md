# zod-prisma-types

> This directory is forked from https://github.com/chrishoermann/zod-prisma-types

`zod-prisma-types` is a generator for [prisma](www.prisma.io) that generates [zod](https://github.com/colinhacks/zod) schemas from your prisma models. This includes schemas of models, enums, inputTypes, argTypes, filters and so on. It also provides options to write advanced zod validators directly in the prisma schema comments.

Since I'm maintaining the generator in my spare time consider buying me a coffee or sponsor me if you like the project. Thanks!

## Breaking changes in v2.x.x

Be aware that some generator options have been removed, a few new have been added, the behaviour of custom imports has changed and ts-morph is no longer needed to generate files in v2.0.0.

## Known issues

> Since `zod version 3.21.2` some schemas throw a typescript error. Please use `zod version 3.21.1` until this issue is resolved.

## Table of contents

- [About this project](#about-this-project)
- [Installation](#installation)
- [Usage](#usage)
  - [`output`](#output)
  - [`useMultipleFiles`](#usemultiplefiles)
  - [`createInputTypes`](#createinputtypes)
  - [`createModelTypes`](#createmodeltypes)
  - [`addInputTypeValidation`](#addinputtypevalidation)
  - [`addIncludeType`](#addincludetype)
  - [`addSelectType`](#addselecttype)
  - [`validateWhereUniqueInput`](#validatewhereuniqueinput)
  - [`createOptionalDefaultValuesTypes`](#createoptionaldefaultvaluestypes)
  - [`createRelationValuesTypes`](#createrelationvaluestypes)
  - [`createPartialTypes`](#createpartialtypes)
  - [`useDefaultValidators`](#usedefaultvalidators)
  - [`coerceDate`](#coercedate)
  - [`writeNullishInModelTypes`](#writenullishinmodeltypes)
  - [`prismaClientPath`](#prismaclientpath)
- [Skip schema generation](#skip-schema-generation)
- [Custom Enums](#custom-enums)
- [Json null values](#json-null-values)
- [Decimal](#decimal)
- [Field validators](#field-validators)
  - [Custom imports](#custom-imports)
  - [Custom type error messages](#custom-type-error-messages)
  - [String validators](#string-validators)
  - [Number validators](#number-validators)
  - [BigInt validators](#bigint-validators)
  - [Date validators](#date-validators)
  - [Custom validators](#custom-validators)
  - [Array validators](#array-validators)
  - [Omit fields](#omit-fields)
  - [Validation errors](#validation-errors)
- [Naming of zod schemas](#naming-of-zod-schemas)
- [Adding comments](#adding-comments)
- [Migration from `zod-prisma`](#migration-from-zod-prisma)
  - [Generator options](#generator-options)
  - [Extending zod fields](#extending-zod-fields)
  - [Importing helpers](#importing-helpers)

## About this project

For one of my projects I was in need of a generator that offers the possibility of adding `zod valdiators` directly in `prisma schema's` [rich-comments](https://www.prisma.io/docs/concepts/components/prisma-schema#comments) and generates `zod` schemas for all prisma models, enums, inputTypes, argTypes, filters and so on. I also wanted to be able to import these schemas in the frontend e.g. for form validation and make the generator as flexible as possbile so it covers a large range of use cases. Since there where no generators out there that met my requirements or they weren't activly maintained anymore I decided to write `zod-prisma-type`.

## Installation

> TBD

## Usage

> Supports prisma 4.x

Just add the following code to your `prisma.schema` file to create a single `index.ts` file in the `./generated/zod` output folder containing all the zod prisma schemas.

```prisma
generator zod {
  provider       = "zod-prisma-types"
}
```

Then import the schema's into your file:

```ts
import { mySchema } from '/prisma/generated/zod' // All schemas are here by default, use the 'output' option to change it
```

> If you encounter errors like the following `/bin/sh: zod-prisma-types: command not found` please try to use the `npx` command with the `zod-prisma-types` command.

```prisma
generator zod {
  provider       = "npx zod-prisma-types"
}
```

If you want to customize the behaviour of the generator you can use the following options:

```prisma
generator zod {
  provider                         = "ts-node-dev ../generator/src/bin.ts"
  output                           = "./generated/zod" // default is ./generated/zod
  useMultipleFiles                 = true // default is false
  createInputTypes                 = false // default is true
  createModelTypes                 = false // default is true
  addInputTypeValidation           = false // default is true
  addIncludeType                   = false // default is true
  addSelectType                    = false // default is true
  validateWhereUniqueInput         = true // default is false
  createOptionalDefaultValuesTypes = true // default is false
  createRelationValuesTypes        = true // default is false
  createPartialTypes               = true // default is false
  useDefaultValidators             = false // default is true
  coerceDate                       = false // default is true
  writeNullishInModelTypes         = true // default is false
  prismaClientPath                 = "./path/to/prisma/client" // default is client output path
}
```

### `useMultipleFiles`

> default: `false`

If you want to create multiple files instead of a single `index.ts` file you can set this option to `true`. This will create a file for each model, enum, inputType, argType, filter, etc. The files will be created in sub folders in the specified output folder and a barrel file will be added at the root of the output folder.

```prisma
generator zod {
  // ...rest of config
  useMultipleFiles = false
}
```

### `output`

> default: `./generated/zod`

Provide an alternative output path.

### `createInputTypes`

> default: `true`

If you just want to create zod schemas for your models and enums you can disable the creation of the corresponding input types. This may be useful if you just want to use zod schemas of your models for validating input types in `react-hook-form` or some similar use cases.

```prisma
generator zod {
  // ...rest of config
  createInputTypes = false
}
```

### `createModelTypes`

> default: `true`

If you just want to create zod schemas for your input types you can disable the creation of the corresponding model schemas. This may be useful if you just want to use the zod input schemas for autocompletion in your trpc queries or similar use cases.

```prisma
generator zod {
  // ...rest of config
  createModelTypes = false
}
```

### `addInputTypeValidation`

> default: `true`

If you want to use your custom zod validatiors that you added via rich-comments only on your generated model schemas but not on your created input type schemas (`UserCreateInput`, `UserUpdateManyInput`, etc.) you can disable this feature.

```prisma
generator zod {
  // ...rest of config
  addInputTypeValidation = false
}
```

### `addIncludeType`

> default: `true`

By default the include type is added to the `[Model]ArgTypeSchema`. If you don't want to add a zod schema for the `include` type you can set this option to `false`.

```prisma
generator zod {
  // ...rest of config
  addIncludeType = false
}
```

### `addSelectType`

> default: `true`

By default the select type is added to the `[Model]ArgTypeSchema`. If you don't want to add a zod schema for the `select` type you can set this option to `false`.

```prisma
generator zod {
  // ...rest of config
  addSelectType = false
}
```

### `validateWhereUniqueInput`

> default: `false`

By default the generator will not validate the `whereUnique` input types in multifile mode since a bunch of unused imports will often be generated. If you want to validate the `whereUnique` input types you can set this option to `true`.

> Be aware that this can lead to eslint errors if you use the `no-unused-vars` rule which you need to resolve manually.

```prisma
generator zod {
  // ...rest of config
  validateWhereUniqueInput = true
}
```

### `createOptionalDefaultValuesTypes`

> default: `false`

If you want to have a schema of your model where where fields with default values are marked as `.optional()` you can pass the following config option:

```prisma
generator zod {
  // ...rest of config
  createOptionalDefaultValuesTypes = true
}

model ModelWithDefaultValues {
  id          Int      @id @default(autoincrement())
  string      String   @default("default")
  otherString String
  int         Int      @default(1)
  otherInt    Int
  float       Float    @default(1.1)
  otherFloat  Float
  boolean     Boolean  @default(true)
  otherBool   Boolean
  date        DateTime @default(now())
  otherDate   DateTime
}
```

The above model would then generate the following model schemas:

```ts
export const ModelWithDefaultValuesSchema = z.object({
  id: z.number(),
  string: z.string(),
  otherString: z.string(),
  int: z.number(),
  otherInt: z.number(),
  float: z.number(),
  otherFloat: z.number(),
  boolean: z.boolean(),
  otherBool: z.boolean(),
  date: z.date(),
  otherDate: z.date(),
})

export const ModelWithDefaultValuesOptionalDefaultsSchema =
  ModelWithDefaultValuesSchema.merge(
    z.object({
      id: z.number().optional(),
      string: z.string().optional(),
      int: z.number().optional(),
      float: z.number().optional(),
      boolean: z.boolean().optional(),
      date: z.date().optional(),
    })
  )
```

### `createRelationValuesTypes`

> default: `false`

If you need a separate model type that includes all the relation fields you can pass the following option. Due to the type annotation, that is needed to have recursive types, this model has some limitations since `z.ZodType<myType>` does not allow some object methods like `.merge()`, `.omit()`, etc.

```prisma
generator zod {
  // ...rest of config
  createRelationValuesTypes = true
}

model User {
  id         String      @id @default(cuid())
  email      String      @unique
  name       String?
  posts      Post[]
  profile    Profile?
  role       Role[]      @default([USER, ADMIN])
  enum       AnotherEnum @default(ONE)
  scalarList String[]

  lat Float
  lng Float

  location Location? @relation(fields: [lat, lng], references: [lat, lng])
}
```

The above model would generate the following model schemas:

```ts
export const UserSchema = z.object({
  role: RoleSchema.array(),
  enum: AnotherEnumSchema,
  id: z.string().cuid(),
  email: z.string(),
  name: z.string().optional(),
  scalarList: z.string().array(),
  lat: z.number(),
  lng: z.number(),
})

export type UserRelations = {
  posts: PostWithRelations[]
  profile?: ProfileWithRelations | null
  location?: LocationWithRelations | null
}
export type UserWithRelations = z.infer<typeof UserSchema> & UserRelations

export const UserWithRelationsSchema: z.ZodType<UserWithRelations> =
  UserSchema.merge(
    z.object({
      posts: z.lazy(() => PostWithRelationsSchema).array(),
      profile: z.lazy(() => ProfileWithRelationsSchema).nullish(),
      location: z.lazy(() => LocationWithRelationsSchema).nullish(),
    })
  )
```

If the option is combined with `createOptionalDefaultValuesTypes` additionally the following model schemas are generated:

```ts
export type UserOptionalDefaultsWithRelations = z.infer<
  typeof UserOptionalDefaultsSchema
> &
  UserRelations

export const UserOptionalDefaultsWithRelationsSchema: z.ZodType<UserOptionalDefaultsWithRelations> =
  UserOptionalDefaultsSchema.merge(
    z.object({
      posts: z.lazy(() => PostWithRelationsSchema).array(),
      profile: z.lazy(() => ProfileWithRelationsSchema).nullable(),
      location: z.lazy(() => LocationWithRelationsSchema).nullable(),
      target: z.lazy(() => LocationWithRelationsSchema).nullable(),
    })
  )
```

### `createPartialTypes`

> default: `false`

If you need a separate model type that includes all the fields as optional you can pass the following option.

```prisma
generator zod {
  // ...rest of config
  createPartialTypes = true
}

model User {
  id         String      @id @default(cuid())
  email      String      @unique
  name       String?
  posts      Post[]
  profile    Profile?
  role       Role[]      @default([USER, ADMIN])
  enum       AnotherEnum @default(ONE)
  scalarList String[]

  lat Float
  lng Float

  location Location? @relation(fields: [lat, lng], references: [lat, lng])
}
```

The above model would generate the following model schemas:

```ts
export const UserPartialSchema = z
  .object({
    role: RoleSchema.array(),
    enum: AnotherEnumSchema,
    id: z.string().cuid(),
    email: z.string().email({ message: 'Invalid email address' }),
    name: z.string().min(1).max(100).nullable(),
    scalarList: z.string().array(),
    lat: z.number(),
    lng: z.number(),
  })
  .partial()
```

When using this option in combination with `createRelationValuesTypes` the following model schemas are also generated. Due do the type annotation, that is needed to have recursive types, this model has some limitations since `z.ZodType<myType>` does not allow some object methods like `.merge()`, `.omit()`, etc.

```ts
export type UserPartialRelations = {
  posts?: PostPartialWithRelations[]
  profile?: ProfilePartialWithRelations | null
  location?: LocationPartialWithRelations | null
}

export type UserPartialWithRelations = z.infer<typeof UserPartialSchema> &
  UserPartialRelations

export const UserPartialWithRelationsSchema: z.ZodType<UserPartialWithRelations> =
  UserPartialSchema.merge(
    z.object({
      posts: z.lazy(() => PostPartialWithRelationsSchema).array(),
      profile: z.lazy(() => ProfilePartialWithRelationsSchema).nullable(),
      location: z.lazy(() => LocationPartialWithRelationsSchema).nullable(),
    })
  ).partial()
```

export type UserPartial = z.infer<typeof UserPartialSchema>;

### `useDefaultValidators`

> default: `true`

In certain use cases the generator adds default validators:

```prisma
model WithDefaultValidators {
  id      String @id @default(cuid())
  idTwo   String @default(uuid())
  integer Int
}
```

```ts
export const WithDefaultValidatorsSchema = z.object({
  id: z.string().cuid(),
  idTwo: z.string().uuid(),
  integer: z.number().int(),
})
```

These defaults are overwritten when using a custom validator (see: [Field Validators](#field-validators))
or when you opt out of using a default validator on a specific field:

```prisma
model WithDefaultValidators {
  id      String @id @default(cuid()) /// @zod.string.noDefault()
  idTwo   String @default(uuid()) /// @zod.string.noDefault()
  integer Int    /// @zod.number.noDefault()
}
```

```ts
export const WithDefaultValidatorsSchema = z.object({
  id: z.string(),
  idTwo: z.string(),
  integer: z.number(),
})
```

You can opt out of this feature completly by passing false to the config option.

```prisma
generator zod {
  // ...rest of config
  useDefaultValidators = false
}
```

> More default validators are planned in future releases (by checking the @db. filds in the schema). If you have some ideas for default validators feel free to open an issue.

### `coerceDate`

> default: true

Per default `DateTime` values are coerced to `Date` objects as long as you pass in a `valid ISO string` or an `instance of Date`. You can change this behavior to generate a simple `z.date()` by passing the following option to the generator config:

```prisma
generator zod {
  // ...rest of config
  coerceDate = false
}
```

### `writeNullishInModelTypes`

> default: false

By default the generator just writes `.nullable()` in the modelTypes when a field in the Prisma type is nullable. If you want these fields to accept `null | undefined`, which would be represented by `.nullish()` in the schema, you can pass the following option to the generator config:

```prisma
generator zod {
  // ...rest of config
  writeNullishInModelTypes = true
}
```

### `prismaClientPath`

> default: `infereed from prisma schema path`

By default the prisma client path is infereed from the `output` path provided in the `prisma.schema` file under `generator client`. If you still need to use a custom path you can pass it to the generator config via this option. A custom path takes precedence over the infereed prisma client output path.

```prisma
generator zod {
  // ...rest of config
  prismaClientPath = "./path/to/prisma/client"
}
```

## Skip schema generation

You can skip schema generation based on e.g. the environment you are currently working in. For example you can only generate the schemas when you're in `development` but not when you run generation in `production` (because in `production` the schemas would already hav been created and pushed to the server via your git repo).

Since Prisma only lets us define `strings` in the generator config we cannot use the `env(MY_ENV_VARIABLE)` method that is used when e.g. the `url` under `datasource db` is loaded:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

To still be able to load environment variables into the generator, just create a `zodGenConfig.js` in your root directory (where the `node_modules` folder is located) and add the following code:

```ts
module.exports = {
  skipGenerator: process.env['SKIP_ZOD_PRISMA'],
}
```

Then add

```js
SKIP_ZOD_PRISMA = 'true'
```

or

```js
SKIP_ZOD_PRISMA = 'false'
```

to your respective `.env` file. This will load the `SKIP_ZOD_PRISMA` environment variable on the `skipGenerator` prop that will then be consumed by the generator.

> You can choose to name your environment variable whatever you want - just make shure to load the right variable in `zodGenConfig.js`.

## Custom Enums

For custom enums a separate type is generated that represents the enum values as a union. Since in typescript unions are more useful than enums this can come in handy.

```prisma
enum MyEnum {
  A
  B
  C
}
```

```ts
export const MyEnumSchema = z.nativeEnum(PrismaClient.MyEnum)

export type MyEnumType = `${z.infer<typeof MyEnumSchema>}` // union of "A" | "B" | "C"
```

## Json null values

When using json null values prisma has a unique way of handling Database `NULL` and JSON `null` as stated [in the Docs](https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#using-null-values).

To adhere to this concept you can pass `"DbNull"` or `"JsonNull"` as string to a nullable Json field. When the schema gets validated these strings are transformed to `Prisma.DbNull` or `Prisma.JsonNull` to satisfy the `prisma.[myModel].create() | .update() | ...` functions.

## Decimal

When using Decimal a `refine` method is used to validate if the input adheres to the prisma input union `string | number | Decimal | DecimalJsLike`.

```prisma
model MyModel {
  id      Int     @id @default(autoincrement())
  decimal Decimal
}
```

The above model would generate the following schema:

```ts
// DECIMAL HELPERS
//------------------------------------------------------

export const DecimalJSLikeSchema: z.ZodType<Prisma.DecimalJsLike> = z.object({
  d: z.array(z.number()),
  e: z.number(),
  s: z.number(),
  toFixed: z.function().args().returns(z.string()),
})

export const DecimalJSLikeListSchema: z.ZodType<Prisma.DecimalJsLike[]> = z
  .object({
    d: z.array(z.number()),
    e: z.number(),
    s: z.number(),
    toFixed: z.function().args().returns(z.string()),
  })
  .array()

export const DECIMAL_STRING_REGEX = /^[0-9.,e+-bxffo_cp]+$|Infinity|NaN/

export const isValidDecimalInput = (
  v?: null | string | number | Prisma.DecimalJsLike
): v is string | number | Prisma.DecimalJsLike => {
  if (v === undefined || v === null) return false
  return (
    (typeof v === 'object' &&
      'd' in v &&
      'e' in v &&
      's' in v &&
      'toFixed' in v) ||
    (typeof v === 'string' && DECIMAL_STRING_REGEX.test(v)) ||
    typeof v === 'number'
  )
}
// SCHEMA
//------------------------------------------------------

export const MyModelSchema = z.object({
  id: z.number(),
  decimal: z
    .union([z.number(), z.string(), DecimalJSLikeSchema])
    .refine((v) => isValidDecimalInput(v), {
      message:
        "Field 'decimal' must be a Decimal. Location: ['Models', 'DecimalModel']",
    }),
})
```

## Field validators

It is possible to add zod validators in the comments of the `prisma.schema` file with the following syntax (use [rich-comments](https://www.prisma.io/docs/concepts/components/prisma-schema#comments) `///` instead of `//`).

```prisma
myField [prisma-scalar-type] /// @zod.[zod-type + optional[(zod-error-messages)]].[zod validators for scalar-type]
```

This may look a bit cryptc so here is an example:

```prisma
generator zod {
  provider       = "zod-prisma-types"
  output         = "./zod"
}

/// @zod.import(["import { myFunction } from 'mypackage';"])
model MyPrismaScalarsType {
  /// @zod.string({ invalid_type_error: "some error with special chars: some + -*#'substring[]*#!§$%&/{}[]", required_error: "some other", description: "some description" }).cuid()
  id         String    @id @default(cuid())
  /// Some comment about string @zod.string.min(3, { message: "min error" }).max(10, { message: "max error" })
  string     String?
  /// @zod.custom.use(z.string().refine((val) => validator.isBIC(val), { message: 'BIC is not valid' }))
  bic        String?
  /// @zod.number.lt(10, { message: "lt error" }).gt(5, { message: "gt error" })
  float      Float
  floatOpt   Float?
  /// @zod.number.int({ message: "error" }).gt(5, { message: "gt error" })
  int        Int
  intOpt     Int?
  decimal    Decimal
  decimalOpt Decimal?
  date       DateTime  @default(now())
  dateOpt    DateTime? /// @zod.date({ invalid_type_error: "wrong date type" })  bigInt     BigInt /// @zod.bigint({ invalid_type_error: "error" })
  bigIntOpt  BigInt?
  /// @zod.custom.use(z.lazy(() => InputJsonValue).refine((val) => myFunction(val), { message: 'Is not valid' }))
  json       Json
  jsonOpt    Json?
  bytes      Bytes /// @zod.custom.use(z.instanceof(Buffer).refine((val) => val ? true : false, { message: 'Value is not valid' }))
  bytesOpt   Bytes?
  /// @zod.custom.use(z.string().refine((val) => myFunction(val), { message: 'Is not valid' }))
  custom     String?
  exclude    String? /// @zod.custom.omit(["model", "input"])

  updatedAt DateTime @updatedAt
}
```

This example generates the following zod schema for the model in `prisma/zod/index.ts`:

```ts
import { z } from 'zod'
import * as PrismaClient from '@prisma/client'
import validator from 'validator'
import { myFunction } from 'mypackage'

export const MyPrismaScalarsTypeSchema = z.object({
  id: z
    .string({
      invalid_type_error:
        "some error with special chars: some + -*#'substring[]*#!§$%&/{}[]",
      required_error: 'some other',
      description: 'some description',
    })
    .cuid(),
  /**
   * Some comment about string
   */
  string: z
    .string()
    .min(3, { message: 'min error' })
    .max(10, { message: 'max error' })
    .nullish(),
  bic: z
    .string()
    .refine((val) => validator.isBIC(val), { message: 'BIC is not valid' })
    .nullish(),
  float: z
    .number()
    .lt(10, { message: 'lt error' })
    .gt(5, { message: 'gt error' }),
  floatOpt: z.number().nullish(),
  int: z.number().int({ message: 'error' }).gt(5, { message: 'gt error' }),
  intOpt: z.number().int().nullish(),
  decimal: z
    .union([
      z.number(),
      z.string(),
      z.instanceof(PrismaClient.Prisma.Decimal),
      DecimalJSLikeSchema,
    ])
    .refine((v) => isValidDecimalInput(v), {
      message: 'Field "decimal" must be a Decimal',
      path: ['Models', 'MyPrismaScalarsType'],
    }),
  decimalOpt: z
    .union([
      z.number(),
      z.string(),
      z.instanceof(PrismaClient.Prisma.Decimal),
      DecimalJSLikeSchema,
    ])
    .refine((v) => isValidDecimalInput(v), {
      message: 'Field "decimalOpt" must be a Decimal',
      path: ['Models', 'MyPrismaScalarsType'],
    })
    .nullish(),
  date: z.coerce.date(),
  dateOpt: z.coerce.date({ invalid_type_error: 'wrong date type' }).nullish(),
  bigIntOpt: z.bigint().nullish(),
  json: z
    .lazy(() => InputJsonValue)
    .refine((val) => myFunction(val), { message: 'Is not valid' }),
  jsonOpt: NullableJsonValue.optional(),
  bytes: z
    .instanceof(Buffer)
    .refine((val) => (val ? true : false), { message: 'Value is not valid' }),
  bytesOpt: z.instanceof(Buffer).nullish(),
  custom: z
    .string()
    .refine((val) => myFunction(val), { message: 'Is not valid' })
    .nullish(),
  // omitted: exclude: z.string().nullish(),
  updatedAt: z.date(),
})

export type MyPrismaScalarsType = z.infer<typeof MyPrismaScalarsTypeSchema>

export const MyPrismaScalarsTypeOptionalDefaultsSchema =
  MyPrismaScalarsTypeSchema.merge(
    z.object({
      id: z
        .string({
          invalid_type_error:
            "some error with special chars: some + -*#'substring[]*#!§$%&/{}[]",
          required_error: 'some other',
          description: 'some description',
        })
        .cuid()
        .optional(),
      date: z.date().optional(),
      updatedAt: z.date().optional(),
    })
  )
```

> Additionally all the zod schemas for the prisma input-, enum-, filter-, orderBy-, select-, include and other necessary types are generated ready to be used in e.g. `trpc` inputs.

## Custom imports

To add custom imports to your validator you can add them via `@zod.import([...myCustom imports as strings])` in prismas rich comments on the model definition.

For example:

```prisma
/// @zod.import(["import { myFunction } from 'mypackage'"])
model MyModel {
  myField String /// @zod.string().refine((val) => myFunction(val), { message: 'Is not valid' })
}
```

This would result in an output like:

```ts
import { myFunction } from 'mypackage'

export const MyModelSchema = z.object({
  myField: z
    .string()
    .refine((val) => myFunction(val), { message: 'Is not valid' }),
})
```

> Please be aware that you have to add an additional level to relative imports if you use the `useMultipleFiles` option.

## Custom type error messages

To add custom zod-type error messages to your validator you can add them via `@zod.[key]({ ...customTypeErrorMessages }).[validator key]`. The custom error messages must adhere to the following type:

```ts
type RawCreateParams =
  | {
      invalid_type_error?: string
      required_error?: string
      description?: string
    }
  | undefined
```

For example:

```prisma
model MyModel {
  myField String /// @zod.string({ invalid_type_error: "invalid type error", required_error: "is required", description: "describe the error" })
}
```

This would result in an output like:

```ts
 string: z.string({
    invalid_type_error: 'invalid type error',
    required_error: 'is required',
    description: 'describe the error',
  }),
```

If you use a wrong key or have a typo the generator would throw an error:

```prisma
model MyModel {
  myField String  /// @zod.string({ required_error: "error", invalid_type_errrrrror: "error"})
}
```

```bash
[@zod generator error]: Custom error key 'invalid_type_errrrrror' is not valid. Please check for typos! [Error Location]: Model: 'Test', Field: 'myField'.
```

## String validators

To add custom validators to the prisma `String` field you can use the `@zod.string` key. On this key you can use all string-specific validators that are mentioned in the [`zod-docs`](https://github.com/colinhacks/zod#strings). You can also add a custom error message to each validator as stated in the docs.

```prisma
model MyModel {
  myField String /// @zod.string.min(3, { message: "min error" }).max(10, { message: "max error" }).[...chain more validators]
}
```

## Number validators

To add custom validators to the prisma `Int` or `Float` field you can use the `@zod.number` key. On this key you can use all number-specific validators that are mentioned in the [`zod-docs`](https://github.com/colinhacks/zod#numbers). You can also add a custom error message to each validator as stated in the docs.

```prisma
model MyModel {
  myField Int
/// @zod.number.lt(10, { message: "lt error" }).gt(5, { message: "gt error" }).[...chain more validators]
}
```

## BigInt validators

To add custom validators to the prisma `BigInt` field you can use the `@zod.bigint` key. On this key you can use all string-specific validators that are mentioned in the [`zod-docs`](https://github.com/colinhacks/zod#bigints). You can also add a custom error message to each validator as stated in the docs.

```prisma
model MyModel {
  myField BigInt /// @zod.bigint.lt(5n, { message: "lt error" }).gt(6n, { message: "gt error" })({ invalid_type_error: "error", ... }).[...chain more validators]
}
```

## Date validators

To add custom validators to the prisma `DateTime` field you can use the `@zod.date` key. On this key you can use all date-specific validators that are mentioned in the [`zod-docs`](https://github.com/colinhacks/zod#dates). You can also add a custom error message to each validator as stated in the docs.

```prisma
model MyModel {
  myField DateTime ///  @zod.date.min(new Date('2020-01-01')).max(new Date('2020-12-31'))
}
```

## Custom validators

To add custom validators to any [`Prisma Scalar`](https://www.prisma.io/docs/reference/api-reference/prisma-schema-reference#model-field-scalar-types) field you can use the `@zod.custom.use()` key. This key has only the `.use(...your custom code here)` validator. This code overwrites all other standard implementations so you have to exactly specify the `zod type` how it should be written by the generator. Only `.optional()` and `.nullable()` are added automatically based on your prisma schema type definition. This field is inteded to provide validators like zod `.refine` or `.transform` on your fields.

```prisma
model MyModel {
  id     Int     @id @default(autoincrement())
  custom String? /// @zod.custom.use(z.string().refine(val => validator.isBIC(val)).transform(val => val.toUpperCase()))
}
```

The above model schema would generate the following zod schema:

```ts
export const MyModel = z.object({
  id: z.number(),
  custom: z
    .string()
    .refine((val) => validator.isBIC(val))
    .transform((val) => val.toUpperCase())
    .nullable(),
})
```

## Array validators

To add custom validators to list fields you can use the `z.[key].array(.length(2).min(1).max(2).nonempty())` validator. You can use this validator on `@zod.string`, `@zod.number`, `@zod.bigint`, `@zod.date` and `@zod.custom`. Furthermore you can use it on enums with the `@zod.enum.array(...)` key and on relations with the `@zod.object.array(...)` key. You can also add a custom error message to each validator as stated in the docs.

```prisma
model MyModel {
  id     Int     @id @default(autoincrement())
  string String[] /// @zod.string.array(.length(2, { message: "my message" }).min(1, { message: "my message" }).max(2, { message: "my message" }).nonempty({ message: "my message" }))
  number Int[] /// @zod.number.array(.length(2).min(1).max(2).nonempty())
  bigint BigInt[] /// @zod.bigint.array(.length(2).min(1).max(2).nonempty())
  date   DateTime[] /// @zod.date.array(.length(2).min(1).max(2).nonempty())
  custom String[] /// @zod.custom.use(z.string().refine(val => validator.isBIC(val)).transform(val => val.toUpperCase())).array(.length(2).min(1).max(2).nonempty())
  enum   MyEnum[] /// @zod.enum.array(.length(2).min(1).max(2).nonempty())
  object MyObject[] /// @zod.object.array(.length(2).min(1).max(2).nonempty())
}
```

The above model schema would generate the following zod schema:

```ts
export const MyModel = z.object({
  id: z.number(),
  string: z
    .string()
    .array()
    .length(2, { message: 'my message' })
    .min(1, { message: 'my message' })
    .max(2, { message: 'my message' })
    .nonempty({ message: 'my message' }),
  number: z.number().array().length(2).min(1).max(2).nonempty(),
  bigint: z.bigint().array().length(2).min(1).max(2).nonempty(),
  date: z.date().array().length(2).min(1).max(2).nonempty(),
  custom: z
    .string()
    .refine((val) => validator.isBIC(val))
    .transform((val) => val.toUpperCase())
    .array()
    .length(2)
    .min(1)
    .max(2)
    .nonempty(),
  enum: MyEnumSchema.array().length(2).min(1).max(2).nonempty(),
})
```

## Omit Fields

It is possible to omit fields in the generated zod schemas by using `@zod.custom.omit(["model", "input"])`. When passing both keys `"model"` and `"input"` the field is omitted in both, the generated model schema and the generated input types (see example below). If you just want to omit the field in one of the schemas just provide the matching key. You can also write the keys without `"` or `'`.

```prisma
model MyModel {
  id           Int     @id @default(autoincrement())
  string       String? /// @zod.string.min(4).max(10)
  omitField    String? /// @zod.custom.omit([model, input])
  omitRequired String /// @zod.custom.omit([model, input])
}
```

The above model would generate the following zod schemas (the omitted keys are left in the model but are commented out so you see at a glance which fields are omitted when looking on the zod schema):

```ts
// MODEL TYPES
// ---------------------------------------

export const MyModelSchema = z.object({
  id: z.number(),
  string: z.string().min(4).max(10).nullish(),
  // omitted: omitField: z.string().nullish(),
  // omitted: omitRequired: z.string(),
})

// INPUT TYPES
// ---------------------------------------

export const MyModelCreateInputSchema: z.ZodType<
  Omit<PrismaClient.Prisma.MyModelCreateInput, 'omitField' | 'omitRequired'>
> = z
  .object({
    string: z.string().min(4).max(10).optional().nullable(),
    // omitted: omitField: z.string().optional().nullable(),
    // omitted: omitRequired: z.string(),
  })
  .strict()

export const MyModelUncheckedCreateInputSchema: z.ZodType<
  Omit<
    PrismaClient.Prisma.MyModelUncheckedCreateInput,
    'omitField' | 'omitRequired'
  >
> = z
  .object({
    id: z.number().optional(),
    string: z.string().min(4).max(10).optional().nullable(),
    // omitted: omitField: z.string().optional().nullable(),
    // omitted: omitRequired: z.string(),
  })
  .strict()

export const MyModelUpdateInputSchema: z.ZodType<
  Omit<PrismaClient.Prisma.MyModelUpdateInput, 'omitField' | 'omitRequired'>
> = z
  .object({
    string: z
      .union([
        z.string().min(4).max(10),
        z.lazy(() => NullableStringFieldUpdateOperationsInputSchema),
      ])
      .optional()
      .nullable(),
    // omitted: omitField: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
    // omitted: omitRequired: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  })
  .strict()

// AND SO ON...

// ARG TYPES
// ---------------------------------------

// To be compatible with the inputTypes the type of the `ArgSchema` is updated accordingly
export const MyModelCreateArgsSchema: z.ZodType<
  Omit<PrismaClient.Prisma.MyModelCreateArgs, 'data'> & {
    data:
      | z.infer<typeof MyModelCreateInputSchema>
      | z.infer<typeof MyModelUncheckedCreateInputSchema>
  }
> = z
  .object({
    select: MyModelSelectSchema.optional(),
    data: z.union([
      MyModelCreateInputSchema,
      MyModelUncheckedCreateInputSchema,
    ]),
  })
  .strict()
```

> When a `required` field is omitted the field needs to be added manually in the respective prisma function like `create`, `update`, `createMany` and so on. Otherwise Typescript would complain.

```ts
const appRouter = t.router({
  createMyModel: t.procedure
    .input(MyModelCreateArgsSchema) // field `omitRequired` is not included in `data`
    .query(({ input }) => {
      return prisma.myModel.create({
        ...input,
        data: {
          ...input.data,
          omitRequired: 'foo', // field needs to be added manually
        },
      })
    }),
})
```

## Validation errors

To ease the developer experience the generator checks if the provided `@zod.[key]` can be used on the respective type of the model field. It also checks if the `@zod.[key].[validator]` can be used on the specified `@zod.[key]`

### `Wrong zod type`

The generator throws an error if you use a validator key like `@zod.string` on the wrong prisma type.

```prisma
model MyModel {
  string String /// @zod.string.min(3) -> valid - `string` can be used on `String`
  number Number /// @zod.string.min(3) -> invalid - `string` can not be used on `Number`
}
```

For the above example the Error message would look like this:

```bash
[@zod generator error]: Validator 'string' is not valid for type 'Int'. [Error Location]: Model: 'MyModel', Field: 'number'
```

The generator provides the exact location, what went wrong and where the error happend. In big prisma schemas with hundreds of models and hundreds of custom validation strings this can come in handy.

### `Wrong validator`

The generator throws an error if you use a validator `.min` on the wrong validator key.

```prisma
model MyModel {
  number Int /// @zod.number.min(3) -> invalid - `min` can not be used on `number`
}
```

The above example would throw the following error:

```bash
[@zod generator error]: Validator 'min' is not valid for type 'Int'. [Error Location]: Model: 'MyModel', Field: 'number'.
```

### `Typo Errors`

If you have typos in your validator strings like

```prisma
model MyModel {
  string String /// @zod.string.min(3, { mussage: 'Must be at least 3 characters' })
}
```

that the generator would throw the following error:

```bash
[@zod generator error]: Could not match validator 'min' with validatorPattern
'.min(3, { mussage: 'Must be at least 3 characters' })'. Please check for typos! [Error Location]: Model: 'MyModel', Field: 'string'.
```

## Naming of zod schemas

The zod types are named after the generated prisma types with an appended `"Schema"` string. You just need to hover over a prisma function and you know which type to import. This would look something like this for trpc v.10:

```ts
import {
  UserFindFirstArgsSchema,
  UserFindManyArgsSchema,
  UserFindUniqueArgsSchema,
} from './prisma/zod'

const appRouter = t.router({
  findManyUser: t.procedure.input(UserFindManyArgsSchema).query(({ input }) => {
    return prisma.user.findMany(input)
  }),
  findUniqueUser: t.procedure
    .input(UserFindUniqueArgsSchema)
    .query(({ input }) => {
      return prisma.user.findUnique(input)
    }),

  findFirstUser: t.procedure
    .input(UserFindFirstArgsSchema)
    .query(({ input }) => {
      return prisma.user.findFirst(input)
    }),
})
```

## Adding comments

You can add [rich-comments](https://www.prisma.io/docs/concepts/components/prisma-schema#comments) to your models and fields that are then printed as jsDoc in your generated zod schema.

```prisma
/// comment line one
/// comment line two
model MyModel {
  id     Int     @id @default(autoincrement())
  /// comment before validator @zod.string.min(4).max(10)
  /// comment after validator
  string String?
}
```

The above model would generate the following output where the validator is extracted from the rich-comments and added to the string field:

```ts
/**
 * comment line one
 * comment line two
 */
export const MyModelSchema = z.object({
  id: z.number(),
  /**
   * comment before validator
   * comment after validator
   */
  string: z.string().min(4).max(10).nullish(),
})
```

The validator is extracted from the comments and added to the string

## Migration from `zod-prisma`

There are a few differences between `zod-prisma` and `zod-prisma-types`.
The following sections should help you migrate from `zod-prisma` to `zod-prisma-types`.

### Generator options

The following generator options from `zod-prisma` are not supported or implemented differently by `zod-prisma-types`:

#### `relationModel`

You can generate a schema that contains all relations of a model by passing the following option to the generator:

```prisma
generator zod {
  // ... other options
  createRelationValuesTypes = true
}
```

See [`createRelationValuesTypes`](#createrelationvaluestypes) for more information.

#### `modelCase`

The casing of the model is fixed to the casing used in the `prisma schema` and can not be changed. This way model names with mixed casing like `MYModel` will work as expected when generating `inputTypes`, `enums`, `argTypes`, etc.

#### `modelSuffix`

The model suffix in `zod-prisma-types` is fixed to `Schema` and can not be changed.

#### `useDecimalJs`

`zod-prisma-types` does not support `decimal.js` but uses the decimal implementation provided by prisma to validate Decimal types. See [Decimal](#decimal) for more information.

#### `imports`

As of version `2.0.0` imports in `zod-prisma-types` are handled with rich-comments on the model definition. See [Custom imports](#custom-imports) for more information.

#### `prismaJsonNullability`

The nullablility in `zod-prisma-types` is handled differently. See [Json null values](#json-null-values) for more information.

### Extending zod fields

`zod-prisma` allows you to extend the zod fields with custom validators. This is also possible with `zod-prisma-types` and the `@zod.[key].[validator]` syntax. The different syntax is used to check if a validator can be used on a specific prisma type. See [Field validators](#field-validators) for more information.

```prisma

// zod-prisma
model MyModel {
  string String /// @zod.min(3) -> valid - `string` can be used on `String`
  number Number /// @zod.min(3) -> valid - throws error only at runtime
}

//zod-prisma-types
model MyModel {
  string String /// @zod.string.min(3) -> valid - `string` can be used on `String`
  number Number /// @zod.string.min(3) -> invalid - throws error during generation
}
```

### Importing helpers

You can import custom helpers in the generator. Please refer to the section about [custom imports](#custom-imports) for more information.
