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
codespell:
	codespell ./src/
