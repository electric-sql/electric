# @file
# @version 0.1
include ../common.mk

export MIGRATION_DIRS=${PROJECT_ROOT}/integration_tests/migrations/migrations

ELECTRIC_SQL_TAG=v0.0.1-initial
ELECTRIC_SQL_CLI_URL=https://github.com/electric-sql/cli/releases/download/${ELECTRIC_SQL_TAG}/electricsql_cli_${ELECTRIC_SQL_TAG}_linux

DOCKER_COMPOSE_FILE=compose.yaml

test:
	${LUX} *.lux

# end

build:

clean:
