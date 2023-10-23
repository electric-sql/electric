include ../common.mk

build:
	docker buildx build --load ${CACHING_SETTINGS} -f ./Dockerfile -t prisma_example:local ${PROJECT_ROOT}/e2e/prisma_example
