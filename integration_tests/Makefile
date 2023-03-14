include common.mk

LUX_DIRS= \
	single_dc \
	multi_dc \
	migrations

deps: lux
	make -C satellite_client build
	make -C elixir_client build

test: deps build pull
	${LUX} ${LUX_DIRS}

build:
	$(foreach dir, $(LUX_DIRS),make -C ${dir} build;)

pull:
	docker-compose -f services_templates.yaml pull \
		vaxine \
		sysbench \
		elixir_client \
		postgresql \
		satellite_client

stop:
	$(foreach dir, $(LUX_DIRS),make -C ${dir} stop_dev_env;)

clean:
	$(foreach dir, $(LUX_DIRS),make -C ${dir} clean;)
	rm -rf lux
	rm -rf postgres
	rm -rf vaxine
