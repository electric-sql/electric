include common.mk

deps: lux
	make -C satellite_client build
	make -C elixir_client build

test_only:
	${LUX} tests

test: deps pull test_only

pull:
	docker compose -f services_templates.yaml pull \
		sysbench \
		postgresql

stop:
	make -C tests stop_dev_env

clean:
	rm -rf lux
	rm -rf postgres
	rm -rf vaxine
