#!/bin/sh

set -ex

if [ ! -f "${DOCKER_COMPOSE_FILE}" ]; then
    echo "Compose file ${DOCKER_COMPOSE_FILE} does not exist"
    exit 1
fi

docker compose -f "${DOCKER_COMPOSE_FILE}" run --no-TTY "$@"
