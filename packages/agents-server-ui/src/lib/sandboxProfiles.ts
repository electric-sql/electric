import { useCallback, useEffect, useRef, useState } from 'react'
import type { ElectricSandboxProfile } from './ElectricAgentsProvider'

/**
 * The default profile is whatever the runtime advertises first — callers
 * must preserve the advertised order (do NOT sort the profile list, or a
 * different profile silently becomes the default).
 */
export function pickDefaultSandboxProfile(
  profiles: ReadonlyArray<ElectricSandboxProfile>
): string | null {
  return profiles.length === 0 ? null : profiles[0]!.name
}

/**
 * Picker selection that survives a live update to the advertised profile
 * list. When the user explicitly picks a profile we remember it and restore
 * it as soon as it's offered again — so a transient list change (e.g. a
 * runtime restart re-advertising its profiles, which briefly drops one)
 * can't silently downgrade an explicit choice to the default. Falls back to
 * the default only when the user hasn't chosen.
 */
export function useSandboxProfileSelection(
  sandboxProfiles: ReadonlyArray<ElectricSandboxProfile>
): readonly [string | null, (next: string) => void] {
  const [sandboxProfile, setSandboxProfile] = useState<string | null>(() =>
    pickDefaultSandboxProfile(sandboxProfiles)
  )
  const chosenRef = useRef<string | null>(null)
  useEffect(() => {
    setSandboxProfile((current) => {
      const chosen = chosenRef.current
      if (chosen && sandboxProfiles.some((p) => p.name === chosen))
        return chosen
      if (current && sandboxProfiles.some((p) => p.name === current))
        return current
      return pickDefaultSandboxProfile(sandboxProfiles)
    })
  }, [sandboxProfiles])
  const choose = useCallback((next: string) => {
    chosenRef.current = next
    setSandboxProfile(next)
  }, [])
  return [sandboxProfile, choose] as const
}

/** True when `name` resolves to an advertised off-host (remote) profile. */
export function isSandboxProfileRemote(
  profiles: ReadonlyArray<ElectricSandboxProfile>,
  name: string | null
): boolean {
  return name != null && profiles.some((p) => p.name === name && p.remote)
}
