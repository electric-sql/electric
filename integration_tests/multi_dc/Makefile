# @file
# @version 0.1
include ../common.mk

DOCKER_COMPOSE_FILE=compose.yaml

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
			-e "s:{REGION}:$${num}:g" \
		< electric.template > electric_$$num.exs; \
	done

create-dc-%:
	docker-compose -f ${DOCKER_COMPOSE_FILE} run --rm ctrl --createDc "$*:8087"

connect-dcs:
	docker-compose -f ${DOCKER_COMPOSE_FILE} run --rm ctrl --connectDcs "vaxine_1:8087" "vaxine_2:8087"

clean:
	rm -rf *.exs
# end
