export PROJECT_ROOT=$(shell git rev-parse --show-toplevel)

mkfile_path := $(abspath $(lastword $(MAKEFILE_LIST)))
export E2E_ROOT := $(dir $(mkfile_path))


# Any timeouts in the tests, specified in seconds,
# are multiplied by this to convert to milliseconds.
# If in CI, double all timeouts to reduce flakiness
TIMEOUT_MULTIPLIER = 1000
ifeq ($(CI), true)
    TIMEOUT_MULTIPLIER = 2000
endif

LUX=${E2E_ROOT}lux/bin/lux --multiplier ${TIMEOUT_MULTIPLIER}

DOCKER_REGISTRY  = europe-docker.pkg.dev/vaxine/vaxine-io
DOCKER_REGISTRY2 = europe-docker.pkg.dev/vaxine/ci
export BUILDER_IMAGE=${DOCKER_REGISTRY2}/electric-builder:latest

export ELIXIR_VERSION=1.15.4
export OTP_VERSION=25.3.2.4
export DEBIAN_VERSION=bullseye-20230612-slim
# using a realistic password for the proxy to prevent accidentally working tests 
# with some default "password"
export PG_PROXY_PASSWORD?=49_G1JYY0BXWldjnA2EFxhWl
export PG_PROXY_PORT?=65432

export UID=$(shell id -u)
export GID=$(shell id -g)

ifdef USE_LOCAL_IMAGE
	export POSTGRESQL_IMAGE?=postgres:local-build
	export SYSBENCH_IMAGE?=sysbench:local-build
else
	export POSTGRESQL_IMAGE?=postgres:14-alpine
	export SYSBENCH_IMAGE?=${DOCKER_REGISTRY}/sysbench:latest
endif

ifeq (${ELECTRIC_IMAGE_NAME}${ELECTRIC_IMAGE_TAG},)
	export ELECTRIC_IMAGE=electric:local-build
	export ELECTRIC_CLIENT_IMAGE=electric-ws-client:local-build
else
	export ELECTRIC_IMAGE=${ELECTRIC_IMAGE_NAME}:${ELECTRIC_IMAGE_TAG}
	export ELECTRIC_CLIENT_IMAGE=${ELECTRIC_CLIENT_IMAGE_NAME}:${ELECTRIC_IMAGE_TAG}
endif


lux: ${LUX}

${LUX}:
	git clone https://github.com/hawk/lux.git
	cd lux && \
	autoconf && \
	./configure && \
	make

sysbench: .sysbench_docker_build

SYSBENCH_COMMIT:=df89d34c410a2277e19f77e47e535d0890b2029b
# FIXME: We should do that in the container where pgsql driver is available
.sysbench_docker_build:
	docker build -f ./docker/Dockerfile.sysbench ./docker --build-arg GIT_CHECKOUT=${SYSBENCH_COMMIT} --tag sysbench:local-build
	touch .sysbench_docker_build

start_dev_env:
	docker compose -f ${DOCKER_COMPOSE_FILE} up --no-color -d pg_1

log_dev_env:
	docker compose -f ${DOCKER_COMPOSE_FILE} logs --no-color --follow pg_1

start_electric_%:
	docker compose -f ${DOCKER_COMPOSE_FILE} up --no-color --no-log-prefix -d electric_$*
	docker compose -f ${DOCKER_COMPOSE_FILE} logs --no-color --follow electric_$*

stop_electric_%:
	docker compose -f ${DOCKER_COMPOSE_FILE} stop electric_$*

stop_dev_env:
	if [ -n "`docker ps --filter name=elixir_client --format '{{.Names}}'`" ]; then \
		docker ps --filter name=elixir_client --format '{{.Names}}' | xargs docker kill; \
	fi
	if [ -n "`docker ps --filter name=satellite_client --format '{{.Names}}'`" ]; then \
		docker ps --filter name=satellite_client --format '{{.Names}}' | xargs docker kill; \
	fi
	if [ -n "`docker ps --filter name=sysbench_run --format '{{.Names}}'`" ]; then \
		docker ps --filter name=sysbench_run --format '{{.Names}}' | xargs docker kill; \
	fi
	docker compose -f ${DOCKER_COMPOSE_FILE} stop --timeout 1
	docker compose -f ${DOCKER_COMPOSE_FILE} down

start_sysbench:
	docker compose -f ${DOCKER_COMPOSE_FILE} run \
		--rm --entrypoint=/bin/bash \
		sysbench

start_elixir_test_%:
	docker compose -f ${DOCKER_COMPOSE_FILE} run \
		--rm \
		elixir_client_$*

start_satellite_client_%:
	docker compose -f ${DOCKER_COMPOSE_FILE} run \
		--rm \
		-e TERM=dumb \
		satellite_client_$*


# PG_PORT should be passed at the call site, e.g. `make docker-psql-1 PG_PORT=54321`
DOCKER_PREFIX:=$(shell basename $(CURDIR))
docker-psql-%:
	docker exec -it -e PGPASSWORD=password ${DOCKER_PREFIX}-$*-1 psql -h $* -p ${PG_PORT} -U postgres -d electric

# PROXY_HOST and PG_HOST should be passed at the call site, e.g. `make docker-proxy PROXY_HOST=electric_1 PG_HOST=pg_1`
docker-proxy:
	docker exec -it -e PGPASSWORD=${PG_PROXY_PASSWORD} ${DOCKER_PREFIX}-${PG_HOST}-1 psql -h ${PROXY_HOST} -p ${PG_PROXY_PORT} -U electric -d electric

docker-attach-%:
	docker compose -f ${DOCKER_COMPOSE_FILE} exec $* bash

docker-prisma:
	DOCKER_COMPOSE_FILE=${DOCKER_COMPOSE_FILE} ../prisma_example/run.sh ${ARGS}

DOCKER_WORKDIR?=${E2E_ROOT}

docker-start-clean-%:
	docker compose -f ${DOCKER_COMPOSE_FILE} run --rm --entrypoint=/bin/sh \
		--workdir=${DOCKER_WORKDIR} \
		$*

docker-make:
	docker compose -f ${DOCKER_COMPOSE_FILE} run --rm \
		--workdir=${DOCKER_WORKDIR} ${MK_DOCKER} \
		make ${MK_TARGET}

single_test:
	${LUX} --progress doc ${TEST}

single_test_debug:
	${LUX} --debug ${TEST}
