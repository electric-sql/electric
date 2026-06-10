import { useEffect, useState } from 'react'
import { loadRealtimeSettingsStatus } from '../lib/server-connection'

export type RealtimeAvailability = {
  loading: boolean
  canStart: boolean
  unavailableReason: string | null
}

function hasDesktopRealtimeSettingsBridge(): boolean {
  return (
    typeof window !== `undefined` &&
    typeof window.electronAPI?.getRealtimeSettings === `function`
  )
}

function missingCredentialsMessage(codexEnabled: boolean): string {
  if (codexEnabled) {
    return `OpenAI API key required for voice mode. Codex sign-in cannot be used for realtime audio.`
  }
  return `OpenAI API key required for voice mode. Add one in Settings > Credentials.`
}

export function useRealtimeAvailability(): RealtimeAvailability {
  const [availability, setAvailability] = useState<RealtimeAvailability>(() => {
    const hasBridge = hasDesktopRealtimeSettingsBridge()
    return {
      loading: hasBridge,
      canStart: !hasBridge,
      unavailableReason: null,
    }
  })

  useEffect(() => {
    let cancelled = false
    if (!hasDesktopRealtimeSettingsBridge()) {
      setAvailability({
        loading: false,
        canStart: true,
        unavailableReason: null,
      })
      return
    }

    setAvailability((current) => ({
      ...current,
      loading: true,
      canStart: false,
    }))
    void loadRealtimeSettingsStatus()
      .then((status) => {
        if (cancelled) return
        if (status.hasOpenAIApiKey) {
          setAvailability({
            loading: false,
            canStart: true,
            unavailableReason: null,
          })
          return
        }
        setAvailability({
          loading: false,
          canStart: false,
          unavailableReason: missingCredentialsMessage(status.codexEnabled),
        })
      })
      .catch(() => {
        if (cancelled) return
        setAvailability({
          loading: false,
          canStart: false,
          unavailableReason: `Unable to check realtime credentials.`,
        })
      })

    return () => {
      cancelled = true
    }
  }, [])

  return availability
}
