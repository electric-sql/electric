# Integration tests

Tests dependencies:
- [Lux (LUcid eXpect scripting) ](https://github.com/hawk/lux/blob/master/INSTALL.md)
- [Docker Compose](https://docs.docker.com/compose/install/)


You will also need an Electric Docker image, specified by the environment variables `ELECTRIC_IMAGE_NAME` and `ELECTRIC_IMAGE_TAG`, which defaults to the image `electric:local-build` that can be built using:
```sh
cd ../components/electric
make docker-build
```

## How to add new test

Add a new `.lux` file in the appropriate subdirectory under `tests/`. Test files are split into multiple directories to keep related tests close to each other. File names are number-prefixed to ensure order of execution of the tests is somewhat predictable, for ease of parsing the output.

Current test groups are:
- `01_sanity_checks/*` - Sanity checks, startup, and electric-PG interaction
- `02_elixir_client/*` - Replication verification between PG and Satellites, without actual clients
- `03_node_client/*` - Replication using an actual typescript client in Node
- `04_misc/*` - Auxillary Electric functions not immediately related to replication
- `05_conflict_resolution/*` - Conflict resolution semantics tests
- `06_permissions/*` - Permissions and write validations

Feel free to add more.

## Common ways to run tests

Build test dependencies at least once to ensure every test can be run
```sh
make deps
```

To build dependencies and run all tests in integration_tests directory
```sh
make test
```

If you don't want to rebuild the dependencies before testing, you can run
```sh
make test_only
```

In order to run single test in one of the integration tests directories, run:

```sh
TEST=tests/01.01_simple_startup.lux make single_test
```

In order to run a [LUX debugger](https://github.com/hawk/lux/blob/master/doc/lux.md#debug_cmds) for that single test, run: 

```sh
TEST=tests/01.01_simple_startup.lux make single_test_debug
```
