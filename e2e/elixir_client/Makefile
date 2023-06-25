include ../common.mk

ELIXIR_BUILD_DOCKER=elixir_client
DOCKER_COMPOSE_FILE=../services_templates.yaml
DOCKER_WORKDIR=${E2E_ROOT}/elixir_client

export DOCKER_REPO ?= europe-docker.pkg.dev/vaxine/ci
export ELECTRIC_CLIENT_IMAGE_NAME ?= electric-ws-client

ELECTRIC_DIR=${PROJECT_ROOT}/components/electric

build:
	make -C ${ELECTRIC_DIR} docker-build-ws-client

clean:
	rm -rf _build
	rm -rf deps
	rm -rf .hex
	rm -rf archives
	rm -rf rebar*
