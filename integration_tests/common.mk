export PROJECT_ROOT=$(shell git rev-parse --show-toplevel)
LUX=${PROJECT_ROOT}/integration_tests/lux/bin/lux
DOCKER_REGISTRY  = europe-docker.pkg.dev/vaxine/vaxine-io
DOCKER_REGISTRY2 = europe-docker.pkg.dev/vaxine/ci
export BUILDER_IMAGE=${DOCKER_REGISTRY2}/electric-builder:latest


export ELIXIR_VERSION=1.13.4
export OTP_VERSION=24.3
export DEBIAN_VERSION=bullseye-20210902-slim
export COMPOSE_COMPATIBILITY=true

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

ifeq (${ELECTRIC_IMAGE_NAME}${ELECTRIC_IMAGE_TAG},)
	export ELECTRIC_IMAGE=electric:local-build
else
	export ELECTRIC_IMAGE=${ELECTRIC_IMAGE_NAME}:${ELECTRIC_IMAGE_TAG}
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
	docker compose -f ${DOCKER_COMPOSE_FILE} up --no-color -d pg_1 pg_2 pg_3 

log_dev_env:
	docker compose -f ${DOCKER_COMPOSE_FILE} logs --no-color --follow


ifdef LUX_EXTRA_LOGS
export VAXINE_VOLUME=${LUX_EXTRA_LOGS}
export SATELLITE_DB_PATH=${LUX_EXTRA_LOGS}
else
export SATELLITE_DB_PATH=.
export VAXINE_VOLUME=.
endif

start_vaxine_%:
	mkdir -p ${VAXINE_VOLUME}/vaxine_$*
	docker compose -f ${DOCKER_COMPOSE_FILE} up --no-color --no-log-prefix vaxine_$*

start_electric_%:
	docker compose -f ${DOCKER_COMPOSE_FILE} up --no-color --no-log-prefix electric_$*

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
	docker compose -f ${DOCKER_COMPOSE_FILE} stop
	docker compose -f ${DOCKER_COMPOSE_FILE} down

start_sysbench:
	docker compose -f ${DOCKER_COMPOSE_FILE} run \
		--rm --entrypoint=/bin/bash \
		sysbench

start_elixir_test_%:
	docker compose -f ${DOCKER_COMPOSE_FILE} run \
		--rm --entrypoint=/bin/bash \
		--workdir=${PROJECT_ROOT}/integration_tests/elixir_client \
		-e ELECTRIC_VERSION=`git describe --abbrev=7 --tags --always --first-parent` \
		elixir_client_$*

start_satellite_client_%:
	docker compose -f ${DOCKER_COMPOSE_FILE} run \
		--rm --entrypoint=/bin/bash \
		--workdir=${PROJECT_ROOT}/integration_tests/satellite_client \
		satellite_client_$*

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
	docker exec -it -e PGPASSWORD=password ${DOCKER_PREFIX}_$*_1 psql -h $* -U postgres -d electric

docker-attach-%:
	docker compose -f ${DOCKER_COMPOSE_FILE} exec $* bash

DOCKER_WORKDIR?=${PROJECT_ROOT}

docker-start-clean-%:
	docker compose -f ${DOCKER_COMPOSE_FILE} run --rm --entrypoint=/bin/sh \
		--workdir=${DOCKER_WORKDIR} \
		$*

docker-make:
	docker compose -f ${DOCKER_COMPOSE_FILE} run --rm \
		--workdir=${DOCKER_WORKDIR} ${MK_DOCKER} \
		make ${MK_TARGET}

single_test:
	${LUX} ${TEST}
