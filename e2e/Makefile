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
	find tests -maxdepth 1 -type f \
	  -name "*.lux" \
	  -and -not -name "03.*.lux" \
	  -and -not -name "07.*.lux" \
	| sort -h \
	| xargs ${LUX} --junit

test-satellite-only:
	${LUX} --junit tests/03.*.lux

test-perftest:
	LUX="${LUX}" ./perftest_initial_sync.sh

pull:
	docker compose -f services_templates.yaml pull \
		postgresql

stop:
	make -C tests stop_dev_env

clean:
	rm -rf lux
	rm -rf postgres
