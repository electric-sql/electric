<a href="https://electric-sql.com">
  <picture>
    <source media="(prefers-color-scheme: dark)"
        srcset="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-light-trans.svg"
    />
    <source media="(prefers-color-scheme: light)"
        srcset="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-black.svg"
    />
    <img alt="ElectricSQL logo"
        src="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-black.svg"
    />
  </picture>
</a>

![License](https://img.shields.io/github/license/electric-sql/electric) [![Tests](https://github.com/electric-sql/electric/actions/workflows/drivers_tests.yml/badge.svg?event=push)](https://github.com/electric-sql/electric/actions/workflows/drivers_tests.yml)

# ElectricSQL Drivers

This package implements a unified `DatabaseAdapter` interface for several SQLite and Postgres database drivers.
Support for other drivers can be added by implementing the `DatabaseAdapter` interface or extending one of the generic drivers: `SerialDatabaseAdapter` or `BatchDatabaseAdapter`. Implement the latter if the underlying driver supports batch execution of queries, otherwise implement the former.

See the:

- [Documentation](https://electric-sql.com/docs/integrations/drivers)
- [How to add support for other drivers](https://electric-sql.com/docs/integrations/drivers/other/generic)

## Install

Using yarn:

```sh
yarn add @electric-sql/drivers
```

Or using npm:

```sh
npm install --save @electric-sql/drivers
```

## Issues

Please raise any bugs, issues and feature requests on [GitHub Issues](https://github.com/electric-sql/electric/issues).

## Contributing

See the [Community Guidelines](https://github.com/electric-sql/meta) including the [Guide to Contributing](https://github.com/electric-sql/meta/blob/main/CONTRIBUTING.md) and [Contributor License Agreement](https://github.com/electric-sql/meta/blob/main/CLA.md).

## Support

We have an [open community Discord](https://discord.electric-sql.com). If you’re interested in the project, please come and say hello and let us know if you have any questions or need any help or support getting things running.
