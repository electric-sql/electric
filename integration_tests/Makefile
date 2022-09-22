include common.mk

LUX_DIRS= \
	single_dc \
	multi_dc

test: lux build
	${LUX} ${LUX_DIRS}

build:
	$(foreach dir, $(LUX_DIRS),make -C ${dir} build;)

clean:
	$(foreach dir, $(LUX_DIRS),make -C ${dir} clean;)
	rm -rf lux
	rm -rf postgres
	rm -rf vaxine
