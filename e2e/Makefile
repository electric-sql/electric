include common.mk

deps: lux
	make -C satellite_client build
	make -C elixir_client build
	make -C prisma_example build

test_sqlite_and_pg: test_only
	make -C tests test_pg

test_only:
	${LUX} --junit tests

test: deps pull test_only

test-no-satellite:
	find tests -type f -maxdepth 1 -name "*.lux" -and -not -name "03.*.lux" | sort -h | xargs ${LUX} --junit

test-satellite-only:
	${LUX} --junit tests/03.*.lux

pull:
	docker compose -f services_templates.yaml pull \
		postgresql

stop:
	make -C tests stop_dev_env

clean:
	rm -rf lux
	rm -rf postgres
