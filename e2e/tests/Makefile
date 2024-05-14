include ../common.mk

DOCKER_COMPOSE_FILE=compose.yaml

test:
	${LUX} *.lux

test_pg:
	DIALECT=Postgres ${LUX} 03.*.lux

docker-prisma:
	DOCKER_COMPOSE_FILE=${DOCKER_COMPOSE_FILE} ../prisma_example/run.sh $(ARGS)
