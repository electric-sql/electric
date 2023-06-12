include ../common.mk

NODEJS_DOCKER=satellite_client
DOCKER_COMPOSE_FILE=../services_templates.yaml
DOCKER_WORKDIR=${E2E_ROOT}/satellite_client

node_modules:
	yarn install --frozen-lockfile --no-default-rc --network-concurrency 1

# By default we would like to build in docker, as we intend
# to run tests with Satellite in it
build:
	docker build -f ./Dockerfile -t satellite_client:local ${PROJECT_ROOT}

local-build: node_modules
	yarn upgrade electric-sql
	yarn build

run_node:
	yarn node

clean:
	rm -rf node_modules
	rm -rf .npm*
	rm -rf .yarn*
	rm -rf .cache
