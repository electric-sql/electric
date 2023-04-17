deps:
	yarn install --frozen-lockfile
#	npm install tslint tslint-config-prettier

build:
	yarn build

tests:
	yarn test

style:
	prettier --check --loglevel warn . && eslint src --quiet

typecheck_tests:
	tsc -p tsconfig.tests.json

# TSModule requires that all source files are under ./src

PROTO_LOCAL?=./proto/satellite.proto
update_proto:
	mkdir -p ./src/_generated
	protoc --plugin=./node_modules/.bin/protoc-gen-ts_proto \
		--ts_proto_opt=outputJsonMethods=false \
		--ts_proto_opt=outputTypeRegistry=true \
		--ts_proto_opt=forceLong=long \
		--ts_proto_opt=importSuffix=.js \
		--ts_proto_opt=esModuleInterop=true \
		--ts_proto_out=./src/_generated/ ${PROTO_LOCAL}

codespell:
	codespell ./proto/ ./src/
