deps:
	pnpm install --frozen-lockfile
	make -C ../clients/typescript build

build: deps
	pnpm run build

tests:
	CI=true pnpm run test
