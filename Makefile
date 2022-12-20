
.PHONY: build_tools deps compile tests start_dev_env stop_dev_env integration_tests rm_offset_storage

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

docker-build:
	docker build -t electric:local-build .

docker-build-ci:
	mkdir -p deps
	docker build -t ${ELECTRIC_IMAGE_NAME}:${ELECTRIC_IMAGE_TAG} \
      -t electric:local-build .
	docker push ${ELECTRIC_IMAGE_NAME}:${ELECTRIC_IMAGE_TAG}

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
