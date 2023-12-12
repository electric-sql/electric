# Integration tests

Tests dependencies:
- lux tool
- docker compose

## How to add new test

Add a new `.lux` file in the `tests/` directory. The files are number-prefixed, for two purposes:
1. to ensure order of execution of the tests to be somewhat predictable, for ease of parsing the output, and
2. to group them by purpose.

Current groups are:
- `1.*` - Sanity checks, startup, and electric-PG interaction
- `2.*` - Replication verification between PG and Satellites, without actual clients
- `3.*` - Replication using an actual typescript client in Node
- `4.*` - Auxillary Electric functions not immediately related to replication
- `5.*` - Conflict resolution semantics tests
- `6.*` - Permissions and write validations

Feel free to add more.

## Common ways to run tests

To run all tests in integration_tests directory
```sh
make test
```

If you don't want to rebuild the dependencies, you can run
```sh
make test_only
```

In order to run single test in one of the integration tests directories, run:

```sh
TEST=tests/1.1_simple_startup.lux make single_test
```

In order to run a [LUX debugger](https://github.com/hawk/lux/blob/master/doc/lux.md#debug_cmds) for that single test, run: 

```sh
TEST=tests/1.1_simple_startup.lux make single_test_debug
```
