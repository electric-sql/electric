# @file
# @version 0.1
include ../common.mk

ELECTRIC_SQL_TAG=v0.0.1-initial
ELECTRIC_SQL_CLI_URL=https://github.com/electric-sql/cli/releases/download/${ELECTRIC_SQL_TAG}/electricsql_cli_${ELECTRIC_SQL_TAG}_linux

DOCKER_COMPOSE_FILE=compose.yaml
# This variable is required for complete docker compose file to be valid until we set it properly when running a particular service
MIGRATION_DIRS ?= /tmp/nonexistent
export MIGRATION_DIRS

test:
	${LUX} *.lux

# end

build:

clean:
