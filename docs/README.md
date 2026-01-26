# ElectricSQL Documentation

This directory contains documentation for the ElectricSQL project.

## Package Documentation

| Package                                                      | Description                                                             |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| [implementation/sync-service/](implementation/sync-service/) | Elixir sync engine - PostgreSQL replication, shape management, HTTP API |

## Adding Documentation for Other Packages

When adding documentation for other packages (e.g., `typescript-client`, `react-hooks`), create a new directory under `implementation/`:

```
docs/
├── README.md (this file)
└── implementation/
    ├── sync-service/     # Elixir sync engine
    ├── typescript-client/ # TypeScript client (future)
    └── react-hooks/       # React integration (future)
```
