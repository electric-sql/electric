include common.mk

export DOCKER_COMPOSE_FILE=compose.yaml

test_only:
	${LUX} tests/*.lux

test-no-satellite:
	find tests -maxdepth 1 -type f -name "*.lux" -and -not -name "03.*.lux" | sort -h | xargs ${LUX} --junit

test-satellite-only:
	${LUX} --junit tests/03.*.lux

test: deps pull test_only

deps: lux
	make -C satellite_client build
	make -C elixir_client build
	make -C prisma_example build

pull:
	docker compose -f services_templates.yaml pull \
		postgresql

stop:
	make -C tests stop_dev_env

clean:
	rm -rf lux
	rm -rf postgres
