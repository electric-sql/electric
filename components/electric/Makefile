
.PHONY: build_tools deps compile tests start_dev_env stop_dev_env integration_tests print_version_from_git

INFERRED_VERSION = $(shell git describe --abbrev=7 --tags --always --first-parent --match '@core/electric@*' | sed -En 's|^@core/electric@||p')
PROTO_DIR ?= ../../protocol
PROTO_FILE ?= $(PROTO_DIR)/satellite.proto

print_version_from_git:
	echo "${INFERRED_VERSION}"

build_tools:
	mix local.hex --force
	mix local.rebar --force

deps:
	mix deps.get

dialyzer:
	mix dialyzer

compile:
	mix compile

compile-%:
	MIX_ENV="$*" mix compile

release:
	MIX_ENV="prod" mix release

release_ws_client:
	MIX_ENV="prod" mix release ws_client

pretest_compile: deps
	MIX_ENV="test" mix compile --force --warnings-as-error

tests:
	mix test --trace

format:
	mix format

check-format:
	mix format --check-formatted

DC_CONFIG=dev/compose.yaml

start_dev_env:
	docker compose -f ${DC_CONFIG} up -d

export UID=$(shell id -u)
export GID=$(shell id -g)

stop_dev_env:
	docker compose -f ${DC_CONFIG} down

DOCKER_PREFIX:=$(shell basename $(CURDIR))
docker-pgsql-%:
	docker exec -it -e PGPASSWORD=password ${DOCKER_PREFIX}_$*_1 psql -h $* -U electric -d electric

ELECTRIC_VERSION ?= ${INFERRED_VERSION}
docker-build:
	docker build --build-arg ELECTRIC_VERSION=${ELECTRIC_VERSION} -t electric:local-build .

ifneq ($(GITHUB_ACTION),)
CACHING_SETTINGS_ELECTRIC := --cache-to type=gha,mode=max,scope=${GITHUB_REF_NAME}-electric --cache-from type=gha,scope=${GITHUB_REF_NAME}-electric
CACHING_SETTINGS_WS_CLIENT := --cache-to type=gha,mode=max,scope=${GITHUB_REF_NAME}-ws-client --cache-from type=gha,scope=${GITHUB_REF_NAME}-ws-client
endif

docker-build-ci:
	docker buildx build --load --build-arg ELECTRIC_VERSION=${ELECTRIC_VERSION} \
      -t ${ELECTRIC_IMAGE_NAME}:${ELECTRIC_VERSION} \
      -t electric:local-build ${CACHING_SETTINGS_ELECTRIC}\
			.
ifeq (${TAG_AS_LATEST_AND_PUSH}, true)
	docker tag "${ELECTRIC_IMAGE_NAME}:${ELECTRIC_VERSION}" "${ELECTRIC_IMAGE_NAME}:latest"
	docker push "${ELECTRIC_IMAGE_NAME}:${ELECTRIC_VERSION}"
	docker push "${ELECTRIC_IMAGE_NAME}:latest"
endif

docker-build-ws-client:
	docker buildx build --load --build-arg ELECTRIC_VERSION=${ELECTRIC_VERSION} \
			--build-arg MAKE_RELEASE_TASK=release_ws_client \
			--build-arg RELEASE_NAME=ws_client \
      -t ${ELECTRIC_CLIENT_IMAGE_NAME}:${ELECTRIC_VERSION} \
      -t electric-ws-client:local-build ${CACHING_SETTINGS_WS_CLIENT}\
			.

docker-build-ci-crossplatform:
	mkdir -p deps
	docker buildx build --platform linux/arm64/v8,linux/amd64 --push \
			--build-arg ELECTRIC_VERSION=${ELECTRIC_VERSION} \
			-t ${ELECTRIC_IMAGE_NAME}:${ELECTRIC_VERSION} \
			-t ${ELECTRIC_IMAGE_NAME}:latest .

docker-clean:
ifneq ($(docker images -q electric:local-build 2> /dev/null), "")
	docker image rm -f electric:local-build
endif

update_protobuf: deps
	mix protox.generate \
		--output-path=./lib/electric/satellite/protobuf_messages.ex \
		--keep-unknown-fields=false \
		${PROTO_FILE}
	mix protox.generate \
		--output-path=./lib/electric/postgres/schema/proto/messages.ex \
		--namespace Electric.Postgres.Schema.Proto \
		--keep-unknown-fields=false \
		$(PROTO_DIR)/postgres_schema.proto

shell:
	iex -S mix

shell_clean:
	iex -S mix run --no-start

codespell:
	codespell -L authentification --skip .git --skip deps
