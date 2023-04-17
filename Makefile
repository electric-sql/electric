build_all:
	make -C sync-service/apps/core docker-build

test_all:
	make -C sync-service/apps/core deps tests
	make -C e2e test