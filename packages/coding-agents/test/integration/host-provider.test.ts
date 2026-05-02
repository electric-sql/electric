// HostProvider scenarios moved to host-provider-conformance.test.ts.
// This file is intentionally empty so vitest's collector doesn't flag
// the missing suite. Delete in a follow-up once the conformance suite
// has shipped for one release cycle.

import { describe, it } from 'vitest'

describe(`HostProvider integration (replaced by conformance suite)`, () => {
  it.skip(`see host-provider-conformance.test.ts`, () => undefined)
})
