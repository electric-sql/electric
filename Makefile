build_all:
	make -C packages/electric docker-build

test_all:
	make -C packages/electric deps tests
	make -C packages/client deps tests
	make -C packages/generator deps tests
	make -C e2e test

update_protobuf:
	make -C packages/electric update_protobuf
	make -C packages/client update_protobuf
