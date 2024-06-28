deps:
	pnpm install --frozen-lockfile

build: node_modules
	pnpm run build

tests:
	pnpm run test

style:
	prettier --check --loglevel warn . && eslint src --quiet

INFERRED_VERSION = $(shell git rev-parse --short HEAD)
publish-canary:
	pnpm version prerelease --preid canary
	jq --arg a "${INFERRED_VERSION}" '.version = (.version | sub("(-canary.*)"; "-canary." + $$a))' package.json > package.json.tmp
	mv package.json.tmp package.json
	pnpm publish --tag canary --access public --no-git-checks --force
