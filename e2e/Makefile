include common.mk

LUX_DIRS= \
	single_dc \
	multi_dc \
	migrations_v2

deps: lux
	make -C satellite_client build
	make -C elixir_client build

build:
	$(foreach dir, $(LUX_DIRS),make -C ${dir} build;)

test_only:
	${LUX} ${LUX_DIRS}

test: deps build pull test_only

pull:
	docker compose -f services_templates.yaml pull \
		vaxine \
		sysbench \
		postgresql

stop:
	$(foreach dir, $(LUX_DIRS),make -C ${dir} stop_dev_env;)

clean:
	$(foreach dir, $(LUX_DIRS),make -C ${dir} clean;)
	rm -rf lux
	rm -rf postgres
	rm -rf vaxine
