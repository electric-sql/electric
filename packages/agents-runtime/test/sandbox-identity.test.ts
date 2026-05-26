import { describe, expect, it } from 'vitest'
import { resolveSandboxIdentity } from '../src/sandbox/identity'

const WAKE = { entityUrl: `/horton/abc/main`, wakeId: `wake-123` }

describe(`resolveSandboxIdentity`, () => {
  describe(`key (identity)`, () => {
    it(`defaults scope to 'entity' → key is the entity url`, () => {
      expect(resolveSandboxIdentity({}, WAKE).sandboxKey).toBe(WAKE.entityUrl)
    })

    it(`scope 'entity' → key is the entity url (stable across wakes)`, () => {
      expect(resolveSandboxIdentity({ scope: `entity` }, WAKE).sandboxKey).toBe(
        WAKE.entityUrl
      )
    })

    it(`scope 'wake' → key is entityUrl#wakeId (per-wake isolation)`, () => {
      expect(resolveSandboxIdentity({ scope: `wake` }, WAKE).sandboxKey).toBe(
        `${WAKE.entityUrl}#${WAKE.wakeId}`
      )
    })

    it(`distinct wake ids under scope 'wake' yield distinct keys`, () => {
      const a = resolveSandboxIdentity(
        { scope: `wake` },
        { entityUrl: WAKE.entityUrl, wakeId: `w1` }
      )
      const b = resolveSandboxIdentity(
        { scope: `wake` },
        { entityUrl: WAKE.entityUrl, wakeId: `w2` }
      )
      expect(a.sandboxKey).not.toBe(b.sandboxKey)
    })

    it(`an explicit key wins over scope`, () => {
      expect(
        resolveSandboxIdentity({ key: `team-room`, scope: `wake` }, WAKE)
          .sandboxKey
      ).toBe(`team-room`)
    })
  })

  describe(`persistent (durability) defaults`, () => {
    it(`scope 'wake' defaults to ephemeral (persistent false)`, () => {
      expect(resolveSandboxIdentity({ scope: `wake` }, WAKE).persistent).toBe(
        false
      )
    })

    it(`scope 'entity' (default) defaults to persistent`, () => {
      expect(resolveSandboxIdentity({}, WAKE).persistent).toBe(true)
      expect(resolveSandboxIdentity({ scope: `entity` }, WAKE).persistent).toBe(
        true
      )
    })

    it(`an explicit key defaults to persistent`, () => {
      expect(
        resolveSandboxIdentity({ key: `team-room` }, WAKE).persistent
      ).toBe(true)
    })

    it(`an explicit persistent value overrides the scope default`, () => {
      // Per-wake but pinned persistent.
      expect(
        resolveSandboxIdentity({ scope: `wake`, persistent: true }, WAKE)
          .persistent
      ).toBe(true)
      // Per-entity but forced ephemeral.
      expect(
        resolveSandboxIdentity({ scope: `entity`, persistent: false }, WAKE)
          .persistent
      ).toBe(false)
      // Explicit key but forced ephemeral.
      expect(
        resolveSandboxIdentity({ key: `team-room`, persistent: false }, WAKE)
          .persistent
      ).toBe(false)
    })
  })

  describe(`owner (role)`, () => {
    it(`defaults to owner`, () => {
      expect(resolveSandboxIdentity({}, WAKE).owner).toBe(true)
      expect(resolveSandboxIdentity({ scope: `wake` }, WAKE).owner).toBe(true)
      expect(resolveSandboxIdentity({ key: `team-room` }, WAKE).owner).toBe(
        true
      )
    })

    it(`an explicit owner:false makes the entity an attacher`, () => {
      // The `inherit` shape: a key adopted from the parent, attach-only.
      const r = resolveSandboxIdentity(
        { key: `/horton/parent`, persistent: true, owner: false },
        WAKE
      )
      expect(r.owner).toBe(false)
      expect(r.sandboxKey).toBe(`/horton/parent`)
      expect(r.persistent).toBe(true)
    })

    it(`owner is orthogonal to identity and durability`, () => {
      // An attacher can still carry a persistent flag (it just never drives
      // teardown); ownership doesn't change the resolved key.
      const r = resolveSandboxIdentity(
        { scope: `wake`, owner: false },
        { entityUrl: `/w/x/main`, wakeId: `k9` }
      )
      expect(r.owner).toBe(false)
      expect(r.sandboxKey).toBe(`/w/x/main#k9`)
    })
  })
})
