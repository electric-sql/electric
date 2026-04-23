<script setup>
import { computed } from "vue"
import { useRoute } from "vitepress"

// Reach into VitePress's default theme for the real `<VPSidebarItem>`.
// The `./dist/*` subpath is exposed via the package.json `exports`
// map, so this is a stable entry point. Using the real component
// (rather than reimplementing markup + classes) means our links pick
// up VitePress's scoped CSS, hover/active states, indicator bar and
// keyboard behaviour automatically — no drift if VitePress changes.
import VPSidebarItem from "vitepress/dist/client/theme-default/components/VPSidebarItem.vue"

/* DocsSidebarHero — title-style button + the product's primary links
   (Overview, Quickstart …) at the top of every product docs sidebar.

   Replaces the previous pattern of starting the sidebar with an
   `Introduction` + `Overview` + `Quickstart` group: the hero button
   IS the introduction (it links back to the marketing page), and
   Overview / Quickstart sit loose underneath it without a redundant
   group heading like "Agents" or "Sync" sitting above them.

   Mounted via the `sidebar-nav-before` slot in `Layout.vue` so it
   renders inside the sidebar, above any sidebar groups defined in
   `.vitepress/config.mts`. */

/** Per-product config:
 *    label    — text shown on the title button (links to `href`)
 *    href     — marketing page the title button links to
 *    matches  — pure function used to pick the active product based
 *               on the current route path; we can't just match on a
 *               single prefix because some products have docs at
 *               `/docs/<product>` while Cloud lives at `/cloud/*`.
 *    primary  — list of `{ text, link }` entries rendered as loose
 *               links directly under the title button. Each entry is
 *               passed straight through to a real `<VPSidebarItem>`,
 *               so they share the exact look + active-state logic of
 *               the regular sidebar items below. */
const PRODUCTS = [
  {
    id: "agents",
    label: "Electric Agents",
    href: "/agents",
    matches: (p) => p.startsWith("/docs/agents"),
    primary: [
      { text: "Overview", link: "/docs/agents" },
      { text: "Quickstart", link: "/docs/agents/quickstart" },
    ],
  },
  {
    id: "streams",
    label: "Electric Streams",
    href: "/streams",
    matches: (p) => p.startsWith("/docs/streams"),
    primary: [
      { text: "Overview", link: "/docs/streams/" },
      { text: "Quickstart", link: "/docs/streams/quickstart" },
    ],
  },
  {
    id: "sync",
    label: "Electric Sync",
    href: "/sync",
    matches: (p) => p.startsWith("/docs/sync"),
    primary: [
      { text: "Overview", link: "/docs/sync" },
      { text: "Quickstart", link: "/docs/sync/quickstart" },
      { text: "Stacks", link: "/docs/sync/stacks" },
    ],
  },
  {
    id: "cloud",
    label: "Electric Cloud",
    href: "/cloud",
    // `/cloud` itself is the marketing page (no sidebar); the hero
    // only renders on `/cloud/usage`, `/cloud/cli`, etc.
    matches: (p) => p.startsWith("/cloud/") && p !== "/cloud/",
    primary: [
      { text: "Usage", link: "/cloud/usage" },
      { text: "CLI", link: "/cloud/cli" },
    ],
  },
]

const route = useRoute()

const product = computed(() => {
  const path = route.path || "/"
  return PRODUCTS.find((p) => p.matches(path)) ?? null
})

/* VitePress's own `<VPSidebarItem>` derives its active state from
   `useData().page.relativePath` (e.g. `docs/agents/index.md`). For
   most links that's fine, but for the Overview link of an `index.md`
   page we've seen the highlight not get applied — the item-side
   `watch` in `useSidebarControl` doesn't always fire on the initial
   mount of links rendered inside this `v-for`, so the `is-active`
   class never reaches the DOM.

   Rather than fight the internals, we compute "is this entry the
   current page?" ourselves from `useRoute().path` and tag the
   wrapper with a class that paints the link in the brand colour.
   `route.path` is updated synchronously on every navigation by
   VitePress's router, so this stays in sync with the page. */
function pathsEqual(a, b) {
  // VitePress can emit the index page as `/docs/agents` or
  // `/docs/agents/`, depending on how the URL was reached. Strip a
  // single trailing slash so both forms compare equal.
  const norm = (p) => (p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p)
  return norm(a) === norm(b)
}

function isEntryActive(entry) {
  return pathsEqual(route.path || "/", entry.link)
}
</script>

<template>
  <div v-if="product" class="docs-sidebar-hero">
    <a
      :class="['docs-sidebar-hero-btn', `docs-sidebar-hero-btn--${product.id}`]"
      :href="product.href"
      :aria-label="`Back to the ${product.label} home page`"
    >
      <span class="docs-sidebar-hero-label">{{ product.label }}</span>
      <span
        class="docs-sidebar-hero-arrow vpi-chevron-right"
        aria-hidden="true"
      />
    </a>
    <!-- Real VPSidebarItem instances — same DOM, same scoped CSS,
         same active-link computation as the regular sidebar items
         that VitePress generates from `themeConfig.sidebar`. We
         render them as direct children of the sidebar's nav slot
         (no wrapping `<section>`) so VitePress's `.VPSidebarItem`
         layout rules apply unchanged. -->
    <template v-if="product.primary && product.primary.length">
      <div
        v-for="entry in product.primary"
        :key="entry.link"
        :class="[
          'docs-sidebar-hero-link',
          { 'docs-sidebar-hero-link--active': isEntryActive(entry) },
        ]"
      >
        <VPSidebarItem :item="entry" :depth="0" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.docs-sidebar-hero {
  /* Breathing room above the button so it doesn't crash into the
     sidebar's top edge. */
  margin-top: 24px;
  /* Mirror the divider VitePress paints between adjacent sidebar
     groups. The reference spacing is:
       last link → 24px (`.VPSidebarItem.level-0 { padding-bottom }`)
                 → 1px hairline (`.group + .group { border-top }`)
                 → 10px (`.group { padding-top }` on desktop)
                 → next group heading
     We collapse the 24px to 0 inside the hero (so Overview/Quickstart
     stack tightly), then re-add the 24px here as our own
     padding-bottom + the hairline. The 10px below the line is
     contributed by the first real `.group` below us, so we don't
     need a margin here. */
  padding-bottom: 24px;
  border-bottom: 1px solid var(--vp-c-divider);
}

/* Title button: pill-style affordance that reads as the "home" of
   the docs section it sits above. The primary links rendered below
   it (Overview, Quickstart …) inherit VitePress's own sidebar item
   styling via `<VPSidebarItem>`. */
.docs-sidebar-hero-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  /* Bottom margin pulls the first VPSidebarItem closer to the
     button than VitePress's own 24px top spacing would. */
  margin-bottom: 12px;
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font-family: var(--vp-font-family-base);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.005em;
  line-height: 1.2;
  text-decoration: none !important;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    color 0.15s ease;
}

.docs-sidebar-hero-btn:hover {
  border-color: var(--vp-c-brand-1);
}

.docs-sidebar-hero-label {
  flex: 1 1 auto;
  min-width: 0;
}

.docs-sidebar-hero-arrow {
  color: var(--vp-c-text-3);
  font-size: 14px;
  line-height: 1;
  transition:
    color 0.15s ease,
    transform 0.15s ease;
  flex-shrink: 0;
}

.docs-sidebar-hero-btn:hover .docs-sidebar-hero-arrow {
  color: var(--vp-c-brand-1);
  transform: translateX(2px);
}
</style>

<style>
/*
  Non-scoped tweaks to the real VPSidebarItem instances rendered
  inside this hero. These targets carry VitePress's `data-v-*`
  scope attribute, but we need to override level-0 typography
  here: VitePress styles `.VPSidebarItem.level-0 .text` as a
  bold "group heading", whereas our primary links should read as
  ordinary navigational items. Ditto for the level-0 padding-bottom
  which would otherwise stack 24px between every link.
*/
.docs-sidebar-hero .VPSidebarItem.level-0 {
  /* VitePress adds 24px between top-level groups. Here every
     "group" is actually a single link, so collapse the spacing. */
  padding-bottom: 0;
}

.docs-sidebar-hero .VPSidebarItem.level-0 .text {
  /* VitePress makes level-0 text 700/text-1 (group heading
     weight). Match the level-1 / level-2 link weight + colour
     instead so Overview / Quickstart read as nav items, not
     section headings. */
  font-weight: 500;
  color: var(--vp-c-text-2);
}

/* Active + hover states for the now-link-styled level-0 items —
   same colours VitePress uses for level-1+ links so the contrast
   feels native. */
.docs-sidebar-hero .VPSidebarItem.level-0.is-link > .item > .link:hover .text {
  color: var(--vp-c-brand-1);
}

.docs-sidebar-hero .VPSidebarItem.level-0.is-active > .item .link > .text,
.docs-sidebar-hero .VPSidebarItem.level-0.is-active > .item > .link > .text {
  color: var(--vp-c-brand-1);
}

/* Wrapper-driven active state. We compute "is this entry the current
   page?" in JS (see `isEntryActive` above) and tag the wrapper —
   this paints the link brand-coloured even when VitePress's own
   `is-active` detection doesn't kick in (notably for the Overview
   link that targets an `index.md` page). The selector is structured
   so its specificity beats VitePress's scoped `.level-0 .text` base
   rule (3 classes + `[data-v-X]` attribute = 0,3,0): we use 4
   classes for a clean win. */
.docs-sidebar-hero
  .docs-sidebar-hero-link--active
  .VPSidebarItem.level-0
  .text {
  color: var(--vp-c-brand-1);
}
</style>
