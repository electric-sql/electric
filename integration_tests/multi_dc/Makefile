# @file
# @version 0.1
include ../Makefile.common.mk

DOCKER_COMPOSE_FILE=multi-dc.yaml

test: build
	${LUX} *.lux

build:
	for num in 1 2 3; do \
		sed -e "s:{VX_HOST}:vaxine_$${num}:g" \
			-e "s:{VX_PORT}:8088:g" \
			-e "s:{AN_PORT}:8087:g" \
			-e "s:{PG_HOST}:pg_$${num}:g" \
			-e "s:{PG_PORT}:5432:g" \
			-e "s:{EL_HOST}:electric_$${num}:g" \
			-e "s:{EL_PORT}:5433:g" \
		< electric.template > electric_$$num.exs; \
	done

clean:
	rm -rf *.exs
# end
