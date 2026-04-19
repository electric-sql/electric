import { ref, onMounted, onUnmounted, type Ref } from "vue"

/**
 * Coordinates animated demos so only the one closest to the viewport
 * center is active at any time. Each demo registers via useDemoVisibility()
 * and receives a reactive `isActive` ref.
 */

interface DemoEntry {
  el: HTMLElement
  active: Ref<boolean>
}

const demos: DemoEntry[] = []
let rafId: number | null = null

function pickActive() {
  const mid = window.innerHeight / 2
  let best: DemoEntry | null = null
  let bestDist = Infinity

  for (const d of demos) {
    const rect = d.el.getBoundingClientRect()
    const top = rect.top
    const bottom = rect.bottom
    // skip if completely off-screen
    if (bottom < 0 || top > window.innerHeight) continue
    const center = (top + bottom) / 2
    const dist = Math.abs(center - mid)
    if (dist < bestDist) {
      bestDist = dist
      best = d
    }
  }

  for (const d of demos) {
    d.active.value = d === best
  }
}

function onScroll() {
  if (rafId != null) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    pickActive()
  })
}

function startListening() {
  window.addEventListener(`scroll`, onScroll, { passive: true })
  window.addEventListener(`resize`, onScroll, { passive: true })
  pickActive()
}

function stopListening() {
  window.removeEventListener(`scroll`, onScroll)
  window.removeEventListener(`resize`, onScroll)
  if (rafId != null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}

export function useDemoVisibility(elRef: Ref<HTMLElement | undefined>) {
  const isActive = ref(false)
  let entry: DemoEntry | null = null

  onMounted(() => {
    if (!elRef.value) return
    entry = { el: elRef.value, active: isActive }
    const wasEmpty = demos.length === 0
    demos.push(entry)
    if (wasEmpty) startListening()
    pickActive()
  })

  onUnmounted(() => {
    if (entry) {
      const idx = demos.indexOf(entry)
      if (idx >= 0) demos.splice(idx, 1)
    }
    if (demos.length === 0) stopListening()
  })

  return isActive
}
