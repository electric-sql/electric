PROJECT_ROOT=$(shell git rev-parse --show-toplevel)
LUX=${PROJECT_ROOT}/integration_tests/lux/bin/lux
DOCKER_REGISTRY=europe-docker.pkg.dev/vaxine/vaxine-io

export UID=$(shell id -u)
export GID=$(shell id -g)

ifdef USE_LOCAL_IMAGE
	export VAXINE_IMAGE?=vaxine:local-build
	export POSTGRESQL_IMAGE?=postgres:local-build
else
	export VAXINE_IMAGE?=${DOCKER_REGISTRY}/vaxine:latest
	export POSTGRESQL_IMAGE?=${DOCKER_REGISTRY}/postgres:latest
endif

lux: ${LUX}

${LUX}:
	git clone https://github.com/hawk/lux.git
	cd lux && \
	autoconf && \
	./configure && \
	make

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

VAXINE_BRANCH?=main
vaxine:
ifdef USE_LOCAL_IMAGE
	git clone https://github.com/vaxine-io/vaxine.git
	cd vaxine && git checkout ${VAXINE_BRANCH} && make docker-build
else
	docker pull ${VAXINE_IMAGE}
endif

postgres:
ifdef USE_LOCAL_IMAGE
	git clone https://github.com/v0idpwn/postgres.git \
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
