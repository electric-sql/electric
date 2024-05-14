deps:
	pnpm install --frozen-lockfile
	make -C ../../clients/typescript build

build:
	deps
	pnpm run build

check_types:
	pnpm run typecheck

check_styleguide:
	pnpm run check-styleguide

tests:
	CI=true pnpm run test
