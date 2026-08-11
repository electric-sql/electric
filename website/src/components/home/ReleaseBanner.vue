<template>
  <div class="release-banner">
    <div class="container">
      <div>
        <a href="/blog/2026/08/11/electric-joining-databricks"
          >⚡&nbsp; Electric is joining
          <span class="hidden-xs"> Neon at </span>
          Databricks &raquo;
        </a>
      </div>
    </div>
  </div>
</template>

<style scoped>
.release-banner {
  /* At ≤860px the homepage hero scene bleeds up to the viewport top
     at `z-index: 2` (see HomeHero.vue), covering static content.
     Layer the banner above it but below the navbar's 30, matching
     how the navbar stays visible/tappable over the bleed. */
  position: relative;
  z-index: 10;
  background: var(--vp-c-bg);

  color: var(--vp-c-text-1);
  border-bottom: 1px solid var(--vp-c-brand-2);
  font-weight: 500;

  padding: 22px 20px 17px;
  margin-bottom: 2px;

  font-size: 15px;
  text-align: center;
}
.release-banner a {
  padding: 18px 24px;
}
.release-banner a:hover {
  color: var(--vp-c-brand-1);
}
@media (max-width: 559px) {
  .release-banner {
    font-size: 14.75px;
  }
  .release-banner a {
    padding: 18px;
  }
}
@media (max-width: 449px) {
  .release-banner {
    font-size: 14px;
  }
  .release-banner a {
    padding: 18px 0px;
  }
}
</style>
<style>
.nav-relative .VPNav {
  position: relative !important;
}
</style>
