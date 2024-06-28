build_generator:
	$(MAKE) -C ../../generator build

deps:
	pnpm install --frozen-lockfile
	make -C ../../packages/drivers build
#	npm install tslint tslint-config-prettier

node_modules:
	pnpm install --frozen-lockfile

build: node_modules
	pnpm run build

build-dev: node_modules
	pnpm run build-dev

tests:
	pnpm run test

tests-CI:
	pnpm run test-CI

style:
	pnpm prettier --check --loglevel warn . && pnpm eslint src --quiet

INFERRED_VERSION = $(shell git rev-parse --short HEAD)
publish-canary:
	pnpm version prerelease --preid canary
	jq --arg a "${INFERRED_VERSION}" '.version = (.version | sub("(-canary.*)"; "-canary." + $$a))' package.json > package.json.tmp
	mv package.json.tmp package.json
	pnpm publish --tag canary --access public --no-git-checks --force

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
