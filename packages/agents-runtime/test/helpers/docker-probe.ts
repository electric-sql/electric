import { isDockerAvailable } from '../../src/sandbox/docker/loader'

/**
 * Module-level Docker availability flag for vitest gating. Resolved
 * eagerly via top-level await so `describe.skipIf(!dockerAvailable)`
 * works at import time. Tests run as no-op skips when Docker is absent.
 */
export const dockerAvailable: boolean = await isDockerAvailable()

/**
 * A small public image with `sh`, `find`, `stat`, `rm`, `kill`, and
 * `node` (so we can also smoke-test program execution). Pinned by digest
 * to keep tests reproducible.
 */
export const TEST_IMAGE = `node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293`

export const TEST_LABEL = `electric-test-sandbox`
