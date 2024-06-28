build_all:
	make -C packages/electric docker-build

test_all:
	make -C packages/electric deps tests
	make -C clients/typescript deps tests
	make -C generator deps tests
	make -C e2e test

update_protobuf:
	make -C packages/electric update_protobuf
	make -C clients/typescript update_protobuf
