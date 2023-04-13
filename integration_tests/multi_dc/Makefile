# @file
# @version 0.1
include ../common.mk

DOCKER_COMPOSE_FILE=compose.yaml

test:
	${LUX} *.lux

create-dc-%:
	docker compose -f ${DOCKER_COMPOSE_FILE} run --rm ctrl --createDc "$*:8087"

connect-dcs:
	docker compose -f ${DOCKER_COMPOSE_FILE} run --rm ctrl --connectDcs "vaxine_1:8087" "vaxine_2:8087"

clean:
	rm -rf *.exs
# end
