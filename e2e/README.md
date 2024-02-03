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

Add a new `.lux` file in the `tests/` directory. The files are number-prefixed, for two purposes:
1. to ensure order of execution of the tests to be somewhat predictable, for ease of parsing the output, and
2. to group them by purpose.

Current groups are:
- `01.*` - Sanity checks, startup, and electric-PG interaction
- `02.*` - Replication verification between PG and Satellites, without actual clients
- `03.*` - Replication using an actual typescript client in Node
- `04.*` - Auxillary Electric functions not immediately related to replication
- `05.*` - Conflict resolution semantics tests
- `06.*` - Permissions and write validations

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
