<script setup lang="ts">
/* BrandToysPage — router wrapper for the /brand-toys page.
   ─────────────────────────────────────────────────────────
   Reads `?id=<slug>` from `window.location.search` and decides
   whether to show the flat grid index or a single-toy stage.

   VitePress ships a static HTML shell per route, so the dynamic
   toy selection has to happen on the client — we wrap everything in
   `<ClientOnly>` so SSR just renders an empty stub and the real UI
   materialises on hydrate. */

import { computed, onMounted, onBeforeUnmount, ref } from "vue"

import BrandToysIndex from "./BrandToysIndex.vue"
import BrandToysToy from "./BrandToysToy.vue"
import { findToy } from "./toys"

// Reactive copy of `window.location.search`. Re-read whenever the
// history changes so in-page navigation (index → toy → back) works
// without a full reload.
const search = ref("")

function syncSearch() {
  if (typeof window === "undefined") return
  search.value = window.location.search
}

// Force the site into dark mode while we're on `/brand-toys`. The toys
// were designed against the dark palette; recordings should always look
// like a dark page even if the visitor's system / VitePress preference
// is set to light. We restore whatever was there before on unmount.
let prevDarkClass: boolean | null = null
function forceDarkMode() {
  if (typeof document === "undefined") return
  prevDarkClass = document.documentElement.classList.contains("dark")
  document.documentElement.classList.add("dark")
}
function restoreDarkMode() {
  if (typeof document === "undefined" || prevDarkClass === null) return
  if (!prevDarkClass) document.documentElement.classList.remove("dark")
  prevDarkClass = null
}

// `popstate` covers browser back/forward. Anchor clicks inside the
// brand-toys index don't navigate to a different *path* (only the
// `?id=…` query changes), so VitePress' SPA router does a
// `pushState` without re-mounting this page. To plug that gap, the
// index dispatches a `brand-toys:navigate` custom event after it
// pushes the new URL — we re-sync on both.
function onNavigate() {
  syncSearch()
}
onMounted(() => {
  forceDarkMode()
  syncSearch()
  window.addEventListener("popstate", syncSearch)
  window.addEventListener("brand-toys:navigate", onNavigate)
})
onBeforeUnmount(() => {
  restoreDarkMode()
  if (typeof window !== "undefined") {
    window.removeEventListener("popstate", syncSearch)
    window.removeEventListener("brand-toys:navigate", onNavigate)
  }
})

const activeToy = computed(() => {
  const q = new URLSearchParams(search.value)
  return findToy(q.get("id"))
})
</script>

<template>
  <ClientOnly>
    <BrandToysToy v-if="activeToy" :key="activeToy.id" :toy="activeToy" />
    <BrandToysIndex v-else />
  </ClientOnly>
</template>
