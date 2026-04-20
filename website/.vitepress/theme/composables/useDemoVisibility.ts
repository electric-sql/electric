import { ref, onMounted, onUnmounted, type Ref } from "vue"

/**
 * Tracks whether an animated demo is currently in view, so the demo can
 * pause its work (timers, RAF loops) when scrolled off-screen and only
 * (re)start once the user actually scrolls it into view.
 *
 * Uses IntersectionObserver with a tight rootMargin so a demo only
 * becomes "visible" when it's well inside the viewport, not when it's
 * just poking up at the bottom edge during initial page load.
 */
interface DemoEntry {
  el: HTMLElement
  active: Ref<boolean>
  visible: boolean
}

const demos: DemoEntry[] = []
let observer: IntersectionObserver | null = null
// Don't activate any demo until the user has actually scrolled. This
// stops demos from auto-starting just because they happen to be partly
// visible at the bottom of the viewport on initial page load — the
// user's intent ("scroll into view") is honoured literally.
let hasScrolled = false
let scrollHandler: (() => void) | null = null

function ensureObserver() {
  if (observer || typeof IntersectionObserver === `undefined`) return
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const d = demos.find((x) => x.el === e.target)
        if (!d) continue
        d.visible = e.isIntersecting
      }
      pickActive()
    },
    {
      // Shrink the effective viewport by 25% on top and bottom so a demo
      // only counts as "in view" once it's properly scrolled into the
      // middle band of the viewport.
      rootMargin: `-25% 0px -25% 0px`,
      threshold: 0,
    }
  )

  if (typeof window !== `undefined` && !scrollHandler) {
    scrollHandler = () => {
      if (hasScrolled) return
      hasScrolled = true
      pickActive()
    }
    window.addEventListener(`scroll`, scrollHandler, { passive: true })
  }
}

function pickActive() {
  // Until the user has scrolled, no demo should be active. This keeps
  // every demo paused on initial page load even when one is partly in
  // the IO "active" band, so animations only start once the user
  // scrolls them into view.
  if (!hasScrolled) {
    for (const d of demos) d.active.value = false
    return
  }

  let chosen: DemoEntry | null = null
  // Of the demos currently visible, pick the topmost one as the active
  // one. This biases toward the demo the user is currently reading.
  for (const d of demos) {
    if (!d.visible) continue
    if (
      !chosen ||
      d.el.getBoundingClientRect().top <
        chosen.el.getBoundingClientRect().top
    ) {
      chosen = d
    }
  }
  for (const d of demos) {
    d.active.value = d === chosen
  }
}

export function useDemoVisibility(elRef: Ref<HTMLElement | undefined>) {
  const isActive = ref(false)
  let entry: DemoEntry | null = null

  onMounted(() => {
    if (!elRef.value) return
    ensureObserver()
    entry = { el: elRef.value, active: isActive, visible: false }
    demos.push(entry)
    observer?.observe(elRef.value)
  })

  onUnmounted(() => {
    if (entry) {
      observer?.unobserve(entry.el)
      const idx = demos.indexOf(entry)
      if (idx >= 0) demos.splice(idx, 1)
    }
    if (demos.length === 0) {
      observer?.disconnect()
      observer = null
      if (scrollHandler && typeof window !== `undefined`) {
        window.removeEventListener(`scroll`, scrollHandler)
        scrollHandler = null
      }
      hasScrolled = false
    }
  })

  return isActive
}
