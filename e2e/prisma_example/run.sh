#!/bin/sh

set -ex

docker compose -f ${DOCKER_COMPOSE_FILE} run $ARGS
