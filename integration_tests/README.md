# Integration tests

Tests dependencies:
- lux tool
- docker-compose

## How to add new lux test directories

The rational behind test directory - to organize tests based on the use-case
or test topology (reflected in docker compose file). To do that - create a new
directory with `Makefile`, include `common.mk`` from the integration_tests
directory and try to reuse targets provided in that file as much as possible.

## Common ways to run tests

To run all tests in integration_tests directory
``` sh
make tests
```

To run tests for specific directory

``` sh
cd multi_dc && make test
```

To run specific test

``` sh
cd multi_dc && lux simple_test.lux
```

By default tests will use Postgres and Vaxine images, fetched from the
registry. If there is a desire to use locally build images one can use
USE_LOCAL_IMAGE variable and/or override one or both images.

To run all tests with locally build images:

``` sh
USE_LOCAL_IMAGE=true make test 
```

