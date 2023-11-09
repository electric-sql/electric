build_generator:
	(cd ../../generator && make deps && make build)

deps:
	pnpm install --frozen-lockfile
#	npm install tslint tslint-config-prettier

node_modules:
	pnpm install --frozen-lockfile

build: node_modules
	pnpm run build

build-dev: node_modules
	pnpm run build-dev

tests:
	pnpm run test

style:
	prettier --check --loglevel warn . && eslint src --quiet

typecheck_tests:
	tsc -p tsconfig.tests.json

# TSModule requires that all source files are under ./src

PROTO_FILE ?= ../../protocol/satellite.proto
PROTO_DIR = $(dir $(abspath $(dir $(PROTO_FILE))))
update_protobuf: node_modules
	mkdir -p ./src/_generated
	protoc --plugin=./node_modules/.bin/protoc-gen-ts_proto \
		--ts_proto_opt=outputJsonMethods=false \
		--ts_proto_opt=outputTypeRegistry=true \
		--ts_proto_opt=forceLong=long \
		--ts_proto_opt=importSuffix=.js \
		--ts_proto_opt=esModuleInterop=true \
		--ts_proto_out=./src/_generated \
		-I ${PROTO_DIR} ${abspath ${PROTO_FILE}}

codespell:
	codespell ./proto/ ./src/
