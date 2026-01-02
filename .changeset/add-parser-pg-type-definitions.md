---
'@electric-sql/client': minor
---

Add type definitions for PostgreSQL types in the parser option.

Introduces a `BuiltInPgType` union type that lists all built-in PostgreSQL type names, providing IDE autocomplete and IntelliSense support when defining custom parsers. The `Parser` type now suggests known PostgreSQL types while still allowing custom types like enums, domains, and composite types.

Also exports `BuiltInPgType`, `Parser`, `ParseFunction`, `pgArrayParser`, and `defaultParser` from the package for easier use by consumers.
