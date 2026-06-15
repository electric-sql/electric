import { useEffect, useRef, useState } from 'react'
import * as Clipboard from 'expo-clipboard'

/**
 * Clipboard copy with transient confirmation state — mirrors the
 * desktop entity header's 1.2s copy→check icon swap. `copiedKey`
 * names the row that last copied so a menu with several copy items
 * only flips the one that was tapped.
 */
export function useCopyFeedback(): {
  copiedKey: string | null
  copy: (key: string, text: string) => void
} {
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const copy = (key: string, text: string): void => {
    void Clipboard.setStringAsync(text)
    setCopiedKey(key)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopiedKey(null), 1200)
  }

  return { copiedKey, copy }
}
