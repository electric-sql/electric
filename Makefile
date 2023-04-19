build_all:
	make -C components/electric docker-build

test_all:
	make -C components/electric deps tests
	make -C clients/typescript deps tests
	make -C e2e test

update_protobuf:
	make -C components/electric update_protobuf
	make -C clients/typescript update_protobuf
