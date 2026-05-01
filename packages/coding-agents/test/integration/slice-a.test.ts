// Slice A lifecycle scenarios moved to the Layer 2 conformance suite at
// packages/coding-agents/src/conformance/integration.ts and exercised
// against LocalDockerProvider via local-docker-conformance.test.ts.
//
// This file is intentionally empty so vitest's collector doesn't flag
// the missing suite. Delete in a follow-up once the conformance suite
// has shipped for one release cycle.

import { describe, it } from 'vitest'

describe(`Slice A — full integration (replaced by conformance suite)`, () => {
  it.skip(`see local-docker-conformance.test.ts`, () => undefined)
})
