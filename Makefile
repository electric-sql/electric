
.PHONY: build_tools deps compile tests start_dev_env stop_dev_env integration_tests rm_offset_storage print_version_from_git

INFERRED_VERSION = $(shell git describe --abbrev=7 --tags --always --first-parent)

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

release:
	MIX_ENV="prod" mix release

pretest_compile: deps
	MIX_ENV="test" mix compile --force --warnings-as-error

tests:
	mix test --trace

format:
	mix format

check-format:
	mix format --check-formatted

DC_CONFIG=compose.yaml

start_dev_env:
	docker-compose -f ${DC_CONFIG} up -d

export UID=$(shell id -u)
export GID=$(shell id -g)
start_dev_env_mounted:
	mkdir -p _tmp_vaxine_data
	docker-compose -f compose-mounts.yaml up -d

stop_dev_env:
	docker-compose -f ${DC_CONFIG} down
	rm -rf _tmp_vaxine_data

DOCKER_PREFIX:=$(shell basename $(CURDIR))
docker-pgsql-%:
	docker exec -it -e PGPASSWORD=password ${DOCKER_PREFIX}_$*_1 psql -h $* -U electric -d electric

ELECTRIC_VERSION ?= ${INFERRED_VERSION}
docker-build:
	docker build --build-arg ELECTRIC_VERSION=${ELECTRIC_VERSION} -t electric:local-build .

docker-build-ci:
	mkdir -p deps
	docker build --build-arg ELECTRIC_VERSION=${ELECTRIC_VERSION} \
      -t ${ELECTRIC_IMAGE_NAME}:${ELECTRIC_VERSION} \
      -t electric:local-build .
	docker push ${ELECTRIC_IMAGE_NAME}:${ELECTRIC_VERSION}
ifeq (${TAG_AS_LATEST}, true)
	docker tag "${ELECTRIC_IMAGE_NAME}:${ELECTRIC_VERSION}" "${ELECTRIC_IMAGE_NAME}:latest"
	docker push "${ELECTRIC_IMAGE_NAME}:latest"
endif

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

rm_offset_storage:
	rm offset_storage_*

update_protobuf: deps
	mix electric.gen.proto.package \
		--output-path=./lib/electric/satellite/protobuf_package.ex \
		./deps/satellite_proto/proto/satellite.proto
	mix protox.generate \
		--output-path=./lib/electric/satellite/protobuf_messages.ex \
		./deps/satellite_proto/proto/satellite.proto
shell:
	iex -S mix

shell_clean:
	iex -S mix run --no-start

apply_migration:
	./apply-local-migration.sh $(name)
