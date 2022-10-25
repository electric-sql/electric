export PROJECT_ROOT=$(shell git rev-parse --show-toplevel)
LUX=${PROJECT_ROOT}/integration_tests/lux/bin/lux
DOCKER_REGISTRY=europe-docker.pkg.dev/vaxine/vaxine-io

export ELIXIR_VERSION=1.13.4
export OTP_VERSION=24.3
export DEBIAN_VERSION=bullseye-20210902-slim

export UID=$(shell id -u)
export GID=$(shell id -g)

ifdef USE_LOCAL_IMAGE
	export VAXINE_IMAGE?=vaxine:local-build
	export POSTGRESQL_IMAGE?=postgres:local-build
	export SYSBENCH_IMAGE?=sysbench:local-build
else
	export VAXINE_IMAGE?=${DOCKER_REGISTRY}/vaxine:latest
	export POSTGRESQL_IMAGE?=${DOCKER_REGISTRY}/postgres:latest
	export SYSBENCH_IMAGE?=${DOCKER_REGISTRY}/sysbench:latest
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
	docker-compose -f ${DOCKER_COMPOSE_FILE} up -d pg_1 pg_2 pg_3

ifndef LUX_EXTRA_LOGS
export VAXINE_VOLUME=.
else
export VAXINE_VOLUME:=${LUX_EXTRA_LOGS}
endif

start_vaxine_%:
	mkdir -p ${VAXINE_VOLUME}/vaxine_$*
	docker-compose -f ${DOCKER_COMPOSE_FILE} up --no-color --no-log-prefix vaxine_$*

start_electric_%:
	docker-compose -f ${DOCKER_COMPOSE_FILE} up --no-color --no-log-prefix electric_$*

stop_dev_env:
	docker-compose -f ${DOCKER_COMPOSE_FILE} down
	docker-compose -f ${DOCKER_COMPOSE_FILE} stop

start_sysbench:
	docker-compose -f ${DOCKER_COMPOSE_FILE} run \
		--rm --entrypoint=/bin/bash \
		sysbench

start_elixir_test:
	docker-compose -f ${DOCKER_COMPOSE_FILE} run \
		--rm --entrypoint=/bin/bash \
		--workdir=${PROJECT_ROOT} \
		test_client

VAXINE_BRANCH?=main
vaxine:
ifdef USE_LOCAL_IMAGE
	git clone https://github.com/electric-sql/vaxine.git
	cd vaxine && git checkout ${VAXINE_BRANCH} && make docker-build
else
	docker pull ${VAXINE_IMAGE}
endif

postgres:
ifdef USE_LOCAL_IMAGE
	git clone https://github.com/electric-sql/postgres.git \
		--branch replication-upsert --depth 1
	cd postgres && ./configure && make docker-build
else
	docker pull ${POSTGRESQL_IMAGE}
endif

DOCKER_PREFIX:=$(shell basename $(CURDIR))
docker-psql-%:
	docker exec -it -e PGPASSWORD=password ${DOCKER_PREFIX}_$*_1 psql -h $* -U electric -d electric

docker-attach-%:
	docker-compose -f ${DOCKER_COMPOSE_FILE} exec $* bash

echo:
	echo ${UID}:${GID}

docker-start-clean-%:
	docker-compose -f ${DOCKER_COMPOSE_FILE} run --rm --entrypoint=/bin/sh $*

single_test:
	${LUX} ${TEST}
