include ../common.mk

NODEJS_DOCKER=satellite_client
DOCKER_COMPOSE_FILE=../services_templates.yaml
DOCKER_WORKDIR=${E2E_ROOT}/satellite_client

ifneq ($(GITHUB_ACTION),)
CACHING_SETTINGS := --cache-to type=gha,mode=max,scope=$GITHUB_REF_NAME-node-client --cache-from type=gha,scope=$GITHUB_REF_NAME-node-client
# else
# CACHING_SETTINGS := --cache-to type=local,mode=max --cache-from type=local
endif
# By default we would like to build in docker, as we intend
# to run tests with Satellite in it
build:
	docker buildx build --load ${CACHING_SETTINGS} -f ./Dockerfile -t satellite_client:local ${PROJECT_ROOT}

local-build:
	pnpm i --frozen-lockfile
	make -C ../../clients/typescript build
	pnpm run build

