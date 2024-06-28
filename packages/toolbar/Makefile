deps:
	make -C ../../packages/client deps
	pnpm install --frozen-lockfile
	make -C ../../packages/client build

build:
	deps
	pnpm run build

check_types:
	pnpm run typecheck

check_styleguide:
	pnpm run check-styleguide

tests:
	CI=true pnpm run test

INFERRED_VERSION = $(shell git rev-parse --short HEAD)
publish-canary:
	pnpm version prerelease --preid canary
	jq --arg a "${INFERRED_VERSION}" '.version = (.version | sub("(-canary.*)"; "-canary." + $$a))' package.json > package.json.tmp
	mv package.json.tmp package.json
	pnpm publish --tag canary --access public --no-git-checks --force

