ElectricSQL works on top of a standard Postgres data model.

The generator has set you up with a simple data model defined in `./db/migrations`. To evolve the schema you can add additional files and apply them using e.g.:

```shell
yarn db:migrate -file db/migrations/your_new_migration.sql
```

See <DocPageLink path="usage/data-modelling/migrations" /> and <DocPageLink path="integrations/backend" /> for more information.
