build_all:
	make -C components/electric docker-build

test_all:
	make -C components/electric deps tests
	make -C e2e test