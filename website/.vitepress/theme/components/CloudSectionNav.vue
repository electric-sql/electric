<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vitepress'
import { CLOUD_PILLS, type CloudPill } from './CloudSectionNav.items'

const props = withDefaults(
  defineProps<{
    showEyebrow?: boolean
    placement?: 'doc' | 'home'
  }>(),
  {
    showEyebrow: true,
    placement: 'doc',
  }
)

const showEyebrow = computed(() => props.showEyebrow)

const route = useRoute()

const activeId = computed(() => {
  const p = route.path || '/'
  for (const pill of CLOUD_PILLS) {
    if (pill.match?.(p)) return pill.id
  }
  return null
})

const scrollerRef = ref<HTMLElement | null>(null)
const activePillRef = ref<HTMLElement | null>(null)

function scrollActiveIntoView() {
  const scroller = scrollerRef.value
  const pill = activePillRef.value
  if (!scroller || !pill) return
  if (scroller.scrollWidth <= scroller.clientWidth) return
  const target =
    pill.offsetLeft - scroller.clientWidth / 2 + pill.clientWidth / 2
  scroller.scrollTo({ left: Math.max(0, target), behavior: 'auto' })
}

onMounted(() => {
  nextTick(scrollActiveIntoView)
})

watch(activeId, () => {
  nextTick(scrollActiveIntoView)
})

function pillProps(pill: CloudPill) {
  if (pill.external) {
    return {
      href: pill.href,
      target: '_blank',
      rel: 'noopener',
    }
  }
  return { href: pill.href }
}
</script>

<template>
  <nav
    class="cloud-section-nav"
    :class="`csn-placement-${placement}`"
    aria-label="Cloud section"
  >
    <div class="csn-inner">
      <div v-if="showEyebrow" class="csn-eyebrow" aria-hidden="true">
        <span class="csn-eyebrow-dot">◉</span>
        <span class="csn-eyebrow-text">Electric Cloud</span>
      </div>
      <div ref="scrollerRef" class="csn-scroller">
        <ul class="csn-list">
          <li
            v-for="pill in CLOUD_PILLS"
            :key="pill.id"
            class="csn-item"
          >
            <a
              v-bind="pillProps(pill)"
              :ref="(el) => { if (activeId === pill.id) activePillRef = el as HTMLElement }"
              class="csn-link"
              :class="{
                active: activeId === pill.id,
                external: pill.external,
              }"
              :aria-current="activeId === pill.id ? 'page' : undefined"
            >
              <span class="csn-link-label">{{ pill.label }}</span>
              <span v-if="pill.external" class="csn-link-arrow" aria-hidden="true">↗</span>
            </a>
          </li>
        </ul>
      </div>
    </div>
  </nav>
</template>

<style scoped>
.cloud-section-nav {
  /* Scrolls with the page (no sticky/fixed). We want the bar to be
     centred on the *viewport*, not on the parent container, so it
     lines up identically across docs pages (where the parent is
     offset left to make room for the right-rail aside) and home/page
     layouts. Using `width: 100vw` plus `left: 50%` + a translateX
     pulls the bar out of the parent's coordinate space and centres it
     relative to the viewport. */
  position: relative;
  left: 50%;
  width: 100vw;
  margin-top: 0;
  margin-bottom: 32px;
  transform: translateX(-50%);
  background: transparent;
}

/*
  Placement-aware top spacing so the bar lands at the same y position
  regardless of which layout slot we're rendered into:

  - `doc`: rendered inside .VPDoc which has `padding-top: 48px` on
    >=960px screens. Pull the bar up so it sits just below the main
    nav (negative margin overshoots the VPDoc padding).
  - `home`: rendered at the top of .VPHome which has no top padding.
    Use a matching negative margin so it lands at the same y.
*/
.cloud-section-nav.csn-placement-doc {
  margin-top: -88px;
}

.cloud-section-nav.csn-placement-home {
  margin-top: -40px;
}

@media (max-width: 959px) {
  /* Below 960px the .VPDoc padding-top drops to 32px and the layout
     margins compress, so use slightly smaller offsets. */
  .cloud-section-nav.csn-placement-doc {
    margin-top: -56px;
  }
  .cloud-section-nav.csn-placement-home {
    margin-top: -32px;
  }
}

.csn-inner {
  max-width: 1152px;
  margin: 0 auto;
  padding: 14px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.csn-eyebrow {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ea-text-3);
  line-height: 1;
}

.csn-eyebrow-dot {
  color: var(--vp-c-brand-1);
  font-size: 10px;
  transform: translateY(-1px);
}

.csn-scroller {
  width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
  margin: -2px -4px;
  padding: 2px 4px;
  display: flex;
  justify-content: center;
}

.csn-scroller::-webkit-scrollbar {
  display: none;
}

.csn-list {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px 8px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.csn-item {
  margin: 0;
  padding: 0;
}

/* Inactive items render as plain text labels — only the active
   page wears the pill chrome (see `.csn-link.active` below). */
.csn-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 7px 14px;
  border-radius: 999px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--vp-c-text-2);
  font-family: var(--vp-font-family-base);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.2;
  text-decoration: none !important;
  white-space: nowrap;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.csn-link:hover {
  color: var(--vp-c-text-1);
}

.csn-link.active {
  background: var(--ec-surface-2);
  border-color: var(--ec-border-2);
  color: var(--vp-c-text-1);
}

.csn-link.external .csn-link-arrow {
  font-size: 13px;
  font-weight: 500;
  color: var(--ea-text-3);
  transform: translateY(-1px);
}

.csn-link.external:hover .csn-link-arrow {
  color: var(--vp-c-brand-1);
}

@media (max-width: 768px) {
  .cloud-section-nav {
    margin-bottom: 24px;
  }

  .csn-inner {
    padding: 12px 16px;
  }

  .csn-scroller {
    justify-content: flex-start;
  }

  .csn-list {
    flex-wrap: nowrap;
    justify-content: flex-start;
    /* Pad on the right so the last pill doesn't collide with the
       scroller's edge / momentum bounce on iOS. */
    padding-right: 8px;
  }

  .csn-link {
    padding: 6px 12px;
    font-size: 13px;
  }
}

@media (max-width: 480px) {
  .csn-eyebrow {
    display: none;
  }
}
</style>

<style>
/*
  Non-scoped rules.
*/

/* Push the right-rail "On this page" aside down so it sits below the
   cloud nav bar instead of overlapping it. The aside-container reads
   `--vp-doc-top-height` and adds it to its own top padding (along
   with the existing 48px gap), so we just need to set this var on
   pages that render the bar. We toggle a class on <body> from
   Layout.vue (`body.has-cloud-nav`).

   This value accounts for the bar's height plus the extra vertical
   space taken up by the ReleaseBanner that renders above the navbar
   on pages without a sidebar (which physically pushes everything
   down ~64px without setting `--vp-layout-top-height`). */
body.has-cloud-nav {
  --vp-doc-top-height: 88px;
}

/* VitePress's default `.aside-content` `min-height` calc does NOT
   include `--vp-doc-top-height`, so when we raise it the inner
   content overshoots the (already shrunk) aside-container and the
   container becomes scrollable even when there's nothing to scroll.
   Override the min-height to subtract `--vp-doc-top-height` too so
   the content fits the available space. */
body.has-cloud-nav .VPDoc .aside-content {
  min-height: calc(
    100vh - (
      var(--vp-nav-height)
      + var(--vp-layout-top-height, 0px)
      + var(--vp-doc-top-height, 0px)
      + 48px
    )
  );
}
</style>
