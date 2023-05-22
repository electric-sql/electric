# @file
# @version 0.1
include ../common.mk

DOCKER_COMPOSE_FILE=compose.yaml

test:
	${LUX} *.lux

# end

build:

clean:

start_dev_env:
	docker compose -f ${DOCKER_COMPOSE_FILE} up --no-color -d pg_1 
