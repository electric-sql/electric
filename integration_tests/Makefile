include common.mk

LUX_DIRS= \
	single_dc \
	multi_dc

test: lux build pull
	${LUX} ${LUX_DIRS}

build:
	$(foreach dir, $(LUX_DIRS),make -C ${dir} build;)

pull:
	docker-compose -f services_templates.yaml pull sysbench postgresql vaxine

clean:
	$(foreach dir, $(LUX_DIRS),make -C ${dir} clean;)
	rm -rf lux
	rm -rf postgres
	rm -rf vaxine
