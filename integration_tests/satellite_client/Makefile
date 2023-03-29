include ../common.mk

NODEJS_DOCKER=satellite_client
DOCKER_COMPOSE_FILE=../services_templates.yaml
DOCKER_WORKDIR=${PROJECT_ROOT}/integration_tests/satellite_client

node_modules:
	yarn install --frozen-lockfile --no-default-rc --network-concurrency 1

# By default we would like to build in docker, as we intend
# to run tests with Satellite in it
build:
	make docker-make MK_TARGET=local-build MK_DOCKER=${NODEJS_DOCKER}

local-build: node_modules
	yarn build

bump-electric-sql:
	yarn remove electric-sql && yarn add git+https://github.com/electric-sql/typescript-client.git#${COMMIT}

run_node:
	yarn node

clean:
	rm -rf node_modules
	rm -rf .npm*
	rm -rf .yarn*
	rm -rf .cache
