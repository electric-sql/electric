# @electric-sql/prisma-generator

## 1.1.6

### Patch Changes

- 837ce928: Extract the sync API out of the DAL and make the DAL optional.

## 1.1.5

### Patch Changes

- 450a65b3: Support for a local Postgres database on the client. Also introduces drivers for node Postgres and PGlite.

## 1.1.4

### Patch Changes

- d8ee5f0e: Do not import `Relation` class if data model does not have any relations - fixes `unused import` TS errors.
- a48bcdc3: [BREAKING] Use `{Table}UncheckedCreateInputSchema` as type for table model to avoid nested types and recursions.
- b7e99c88: Added support for BYTEA/BLOB column type across the sync service, TS client, and client generator

## 1.1.3

### Patch Changes

- d3cf7043: Revert change to generator to add .js extension to imports for nodenext compatibility as it broke for some bundlers.
- 4fe5c7f6: Adds client-side support for enumerations.

## 1.1.2

### Patch Changes

- 22652fb3: Change generator to add .js extention to imports for nodenext compatibility
- 38e1e44b: Fix type issue in generated client for DB schemas containing relations.

## 1.1.1

### Patch Changes

- 4ad7df4d: [VAX-825] Add client-side support for JSON type.
- 65f10d69: Import types using import type in generated Electric client.

## 1.1.0

### Minor Changes

- d109a1e7: Major new release that introduces Electric Postgres Proxy, affecting all Electric components.

### Patch Changes

- 318b26d6: Adds client-side support for booleans.
- 00eb469d: Adds client-side support for float8 data type.
- 88a53756: Adds client-side support for int2 and int4 types.
- 3ae3f30a: Adds client-side support for timestamps, times, and dates.
- 88a53756: Add client-side validations for UUIDs.

## 1.0.2

### Patch Changes

- 5567869: Use PascalCased model names in generated Prisma schema and map them to the original table names.
- 9db6891: Also fix casing in types that refer to model names

## 1.0.2-next.0

### Patch Changes

- 5567869: Use PascalCased model names in generated Prisma schema and map them to the original table names.
- 9db6891: Also fix casing in types that refer to model names

## 1.0.1

### Patch Changes

- 88c077f: Enabled correct binary name `electric-sql-prisma-generator` for the package
