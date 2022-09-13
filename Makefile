deps:
	npm ci
#	npm install tslint tslint-config-prettier

build:
	npm run build

tests:
	npm test

PROTO_LOCAL?=./proto/satellite.proto
update_proto:
	protoc --plugin=./node_modules/.bin/protoc-gen-ts_proto \
		--ts_proto_opt=outputJsonMethods=false \
		--ts_proto_opt=outputTypeRegistry=true \
		--ts_proto_opt=forceLong=long \
		--ts_proto_out=./gen/ ${PROTO_LOCAL}
