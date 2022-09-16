
.PHONY: build_tools deps compile tests start_dev_env stop_dev_env integration_tests rm_offset_storage

build_tools:
	mix local.hex --force
	mix local.rebar --force

deps: deps_proto
	mix deps.get

deps_proto: ./proto/satellite

./proto/satellite:
	./get-proto.sh

dialyzer:
	mix dialyzer

compile:
	mix compile

release:
	MIX_ENV="prod" mix release

pretest_compile: deps
	MIX_ENV="test" mix compile --force --warnings-as-error

tests:
	mix test

format:
	mix format

check-format:
	mix format --check-formatted

DC_CONFIG=compose.yaml

start_dev_env:
	docker-compose -f ${DC_CONFIG} up -d

stop_dev_env:
	docker-compose -f ${DC_CONFIG} down

docker-build:
	docker build -t electric:local-build .

docker-build-ci:
	docker pull ${ELECTRIC_IMAGE_NAME}:${ELECTRIC_IMAGE_TAG} || true
	docker pull ${ELECTRIC_IMAGE_NAME}:latest || true
	docker build --cache-from ${ELECTRIC_IMAGE_NAME}:${ELECTRIC_IMAGE_TAG} \
      --cache-from ${ELECTRIC_IMAGE_NAME}:latest \
      -t ${ELECTRIC_IMAGE_NAME}:${ELECTRIC_IMAGE_TAG} \
      -t electric:local-build .
	docker push ${ELECTRIC_IMAGE_NAME}:${ELECTRIC_IMAGE_TAG}

docker-clean:
ifneq ($(docker images -q electric:local-build 2> /dev/null), "")
	docker image rm -f electric:local-build
endif

rm_offset_storage:
	rm vx_pg_offset_storage_*

update_protobuf: deps_proto
	mix protox.generate \
		--output-path=./lib/electric/satellite/satellite_pb.ex \
		./proto/satellite/proto/satellite.proto

shell:
	iex -S mix

shell_clean:
	iex -S mix run --no-start
