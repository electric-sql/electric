# @electric-sql/prisma-generator

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
