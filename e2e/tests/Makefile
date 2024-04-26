include ../common.mk

DOCKER_COMPOSE_FILE=compose.yaml

test:
	${LUX} *.lux

debug_sqlite:
	${LUX} 03.25_*.lux

debug_pg:
	DIALECT=Postgres ${LUX} 03.25_*.lux
