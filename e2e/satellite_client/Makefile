include ../common.mk

NODEJS_DOCKER=satellite_client
DOCKER_COMPOSE_FILE=../services_templates.yaml
DOCKER_WORKDIR=${E2E_ROOT}/satellite_client

# By default we would like to build in docker, as we intend
# to run tests with Satellite in it
build:
	docker build -f ./Dockerfile -t satellite_client:local ${PROJECT_ROOT}

local-build:
	pnpm i --frozen-lockfile
	make -C ../../clients/typescript build
	pnpm run build

