include common.mk

deps: lux
	make -C satellite_client build
	make -C elixir_client build

test: deps pull
	${LUX} tests

pull:
	docker compose -f services_templates.yaml pull \
		sysbench \
		elixir_client \
		postgresql

stop:
	make -C tests stop_dev_env

clean:
	rm -rf lux
	rm -rf postgres
	rm -rf vaxine
