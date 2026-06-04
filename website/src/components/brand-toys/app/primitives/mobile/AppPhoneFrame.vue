<script setup lang="ts">
/* AppPhoneFrame — generic dark phone bezel chrome.
   ─────────────────────────────────────────────────────────────────
   Renders an outer phone-shaped bezel with a dynamic-island notch
   at the top centre and a home-indicator pill at the bottom. The
   inner screen is exposed via the default slot — the consuming
   scene drops its app chrome + body into the slot.

   Why a separate primitive (rather than baking the bezel into the
   mobile scene): the bezel is OS-chrome-style (not Electric Agents
   chrome); reusing it across mockups (e.g. App Store screenshots,
   marketing visuals) is cleaner if it lives on its own. The
   chrome inside the screen is what carries the React Native nav
   bar — that's `AppMobileTitleBar`, mounted by the consuming scene.

   Geometry (calibrated against an iPhone 14/15 Pro):
     - 9:19.5 aspect ratio so the slot footprint reads as a modern
       iPhone shape rather than the older 16:9 stretched look.
     - Bezel thickness ≈ 1.7 % of width, constant on all sides.
       The screen corner radius is derived from the same outer radius
       minus that bezel inset, so the curves stay concentric.
     - Dynamic island: a small black pill ≈ 22 % of width, sized at
       a fixed 22 px tall, anchored ~1.5 % from the top of the
       device. The screen content's safe-area top inset clears it.
     - Home indicator: thin rounded pill ≈ 30 % of width centred
       at the bottom, sitting above the bottom bezel.

   Pure primitive — does NOT include `.app-mockup-root`. */

withDefaults(
  defineProps<{
    /** Mode label shown for accessibility. The chrome itself has
     * no visible labels. */
    deviceLabel?: string
  }>(),
  {
    deviceLabel: 'Phone mockup',
  }
)
</script>

<template>
  <div class="phone-frame" role="img" :aria-label="deviceLabel">
    <div class="phone-screen">
      <slot />
    </div>
    <span class="phone-island" aria-hidden="true" />
    <span class="phone-home" aria-hidden="true" />
  </div>
</template>

<style scoped>
.phone-frame {
  position: relative;
  width: 100%;
  --phone-bezel: 4px;
  --phone-radius: 34px;
  /* 9:19.5 aspect — iPhone Pro family. The host (page) controls
     overall size by setting width or height on the wrapper. */
  aspect-ratio: 9 / 19.5;
  /* Outer body gradient — a deep neutral with a subtle highlight
     along the top edge so it reads as a metal-glass device rather
     than a flat black rectangle. */
  background:
    radial-gradient(
      120% 60% at 50% 0%,
      rgba(255, 255, 255, 0.06) 0%,
      rgba(255, 255, 255, 0) 40%
    ),
    linear-gradient(180deg, #1a1a20 0%, #0a0a0d 60%, #16161a 100%);
  border-radius: var(--phone-radius);
  box-shadow:
    /* Outer rim highlight — tiny inset ring brightening the bezel
       edge so it reads as a polished frame, not a matte cutout. */
    inset 0 0 0 1px rgba(255, 255, 255, 0.08),
    /* Outer shadow handled by the page-level wrapper (so it can
       drop the shadow on the page background, not on the device
       itself). */
      0 0 0 0;
  isolation: isolate;
}

.phone-screen {
  position: absolute;
  inset: var(--phone-bezel);
  /* Screen radius is the outer radius minus the constant bezel inset,
     which keeps the screen and bezel curves concentric. */
  border-radius: calc(var(--phone-radius) - var(--phone-bezel));
  overflow: hidden;
  /* Inner screen background — matches the dark-mode app shell so
     the screen reads as on even before the slot content paints. */
  background: var(--ds-bg, #0a0a0d);
  /* A faint inner border to separate the screen edge from the
     bezel — same trick the live device has from the screen
     coating reflecting the bezel's inner ring. */
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.04),
    inset 0 0 24px rgba(0, 0, 0, 0.4);
}

/* ───────── Dynamic island ─────────
   Sits INSIDE the screen, just below the rounded top corner so it
   reads as a cutout in the panel rather than a decoration in the
   bezel. The slot content (the title bar) starts BELOW it via the
   consuming scene's safe-area top inset so the island doesn't
   overlap the title. */
.phone-island {
  position: absolute;
  /* Below the bezel + a small inset clear of the rounded screen
     corner. Tuned against the 9:19.5 phone shape so the island
     sits where iPhone Pro's island sits relative to the screen. */
  top: 2.4%;
  left: 50%;
  transform: translateX(-50%);
  width: 17%;
  height: 17px;
  background: #000;
  border-radius: 999px;
  /* Subtle highlight along the top edge so the island reads as
     glossy glass, not a flat decal. */
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    0 0 0 1px rgba(0, 0, 0, 0.6);
  z-index: 2;
}

/* ───────── Home indicator ─────────
   The thin rounded pill at the bottom of the screen — inside the
   screen interior, above the bottom bezel and clear of the
   composer slab's bottom edge. */
.phone-home {
  position: absolute;
  bottom: 2.4%;
  left: 50%;
  transform: translateX(-50%);
  width: 30%;
  height: 4px;
  background: rgba(255, 255, 255, 0.7);
  border-radius: 999px;
  z-index: 2;
}
</style>
