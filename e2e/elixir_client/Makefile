include ../common.mk

ELIXIR_BUILD_DOCKER=elixir_client
DOCKER_COMPOSE_FILE=../services_templates.yaml
DOCKER_WORKDIR=${E2E_ROOT}/elixir_client

export DOCKER_REPO ?= europe-docker.pkg.dev/vaxine/ci
export BUILDER_IMAGE=${DOCKER_REPO}/electric-builder:latest

ELECTRIC_DIR=${PROJECT_ROOT}/components/electric

build:
	make docker-make MK_TARGET=local-build MK_DOCKER=${ELIXIR_BUILD_DOCKER}

local-build:
	(cd ${ELECTRIC_DIR} && make build_tools deps compile-test)

run_elixir:
	(cd ${ELECTRIC_DIR} && iex -S mix run --no-start --no-deps-check -e "Application.put_env(:elixir, :ansi_enabled, false)")

clean:
	rm -rf _build
	rm -rf deps
	rm -rf .hex
	rm -rf archives
	rm -rf rebar*
