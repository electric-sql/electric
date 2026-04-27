<script setup>
/* Footer is intentionally empty of script — the appearance switcher
   was removed when the site was forced to dark-only via
   `appearance: 'force-dark'` in `.vitepress/config.mts`. */
import MarkdownLink from './MarkdownLink.vue'
</script>

<template>
  <footer class="VPFooter">
    <div class="container">
      <p class="footer-logo">
        <img class="footer-logo-img footer-logo-dark" src="/img/brand/logo.svg" alt="Electric" />
        <img class="footer-logo-img footer-logo-light" src="/img/brand/logo.inverse.svg" alt="Electric" />
      </p>

      <nav class="footer-nav">
        <a href="/about/community">About</a>
        <a href="/about/contact">Contact</a>
        <a href="/about/legal/terms">Legal</a>
        <a href="/docs/sync/">Docs</a>
        <a href="/sync/demos/">Demos</a>
        <a href="/blog">Blog</a>
        <a href="https://dashboard.electric-sql.cloud/">Sign up</a>
      </nav>

      <nav class="footer-social">
        <a href="https://tanstack.com/db" aria-label="TanStack DB">
          <span class="vpi-social-tanstack"></span>
          <span class="social-name">TanStack DB</span>
        </a>
        <a href="https://pglite.dev" aria-label="PGlite">
          <span class="vpi-social-pglite"></span>
          <span class="social-name">PGlite</span>
        </a>
        <a href="https://x.com/ElectricSQL" aria-label="X">
          <span class="vpi-social-x"></span>
          <span class="social-name">X</span>
        </a>
        <a href="https://bsky.app/profile/electric-sql.com" aria-label="Bluesky">
          <span class="vpi-social-bluesky"></span>
          <span class="social-name">Bluesky</span>
        </a>
        <a href="https://discord.electric-sql.com" aria-label="Discord">
          <span class="vpi-social-discord"></span>
          <span class="social-name">Discord</span>
        </a>
        <a href="https://github.com/electric-sql" aria-label="GitHub">
          <span class="vpi-social-github"></span>
          <span class="social-name">GitHub</span>
        </a>
      </nav>

      <p class="copyright">
        © {{ new Date().getFullYear() }} Electric DB Inc. Released under the
        <a href="https://github.com/electric-sql/electric/blob/main/LICENSE" target="_blank">Apache 2.0</a>
        License.
      </p>
      <div class="footer-markdown-link">
        <MarkdownLink variant="footer" />
      </div>
    </div>
  </footer>
</template>

<style scoped>
.VPFooter {
  position: relative;
  z-index: var(--vp-z-index-footer);
  border-top: 1px solid var(--vp-c-divider);
  padding: 40px 24px 32px !important;
  margin-bottom: 0;
  display: block;
}

.VPFooter.has-sidebar {
  display: none;
}

.container {
  margin: 0 auto;
  max-width: var(--vp-layout-max-width);
  text-align: center;
}

/* Logo — kept but smaller and softer than before */
.footer-logo {
  margin: 0 0 18px;
}
.footer-logo img {
  width: 88px;
  margin: 0 auto;
  opacity: 0.85;
}
.footer-logo-light {
  display: inline-block;
}
.footer-logo-dark {
  display: none;
}
:deep(html.dark) .footer-logo-light,
.dark .footer-logo-light {
  display: none;
}
:deep(html.dark) .footer-logo-dark,
.dark .footer-logo-dark {
  display: inline-block;
}

/* Nav rows — flat, muted, no underlines, no brand colour */
.footer-nav,
.footer-social {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 20px 24px;
  margin: 0 0 14px;
}

.footer-nav a,
.footer-social a {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 400;
  color: var(--vp-c-text-2);
  text-decoration: none;
  transition: color 0.2s;
}
.footer-nav a:hover,
.footer-nav a:focus-visible,
.footer-social a:hover,
.footer-social a:focus-visible {
  color: var(--vp-c-text-1);
  text-decoration: underline;
}

/* Social icons */
.footer-social .vpi-social-tanstack,
.footer-social .vpi-social-pglite,
.footer-social .vpi-social-x,
.footer-social .vpi-social-bluesky,
.footer-social .vpi-social-discord,
.footer-social .vpi-social-github {
  display: inline-block;
  width: 16px;
  height: 16px;
}

.vpi-social-x {
  --icon: url('https://api.iconify.design/simple-icons/x.svg');
}
.vpi-social-bluesky {
  --icon: url('https://api.iconify.design/simple-icons/bluesky.svg');
}
.vpi-social-discord {
  --icon: url('https://api.iconify.design/simple-icons/discord.svg');
}
.vpi-social-tanstack {
  --icon: url('https://api.iconify.design/simple-icons/tanstack.svg');
}

/* Hide the social labels on small screens — icons remain */
@media (max-width: 599px) {
  .footer-social .social-name {
    display: none;
  }
  .footer-social {
    gap: 18px;
  }
}

/* Copyright — smallest, faintest line */
.copyright {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--vp-c-text-3, var(--vp-c-text-2));
}
.copyright a {
  color: var(--vp-c-text-2);
  text-decoration: underline;
}
.copyright a:hover,
.copyright a:focus-visible {
  color: var(--vp-c-text-1);
  text-decoration: underline;
}

.footer-markdown-link {
  display: flex;
  justify-content: center;
  margin-top: 12px;
}

.footer-markdown-link :deep(.markdown-link-footer) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 400;
  color: var(--vp-c-text-2);
  text-decoration: none;
  transition: color 0.2s;
}

.footer-markdown-link :deep(.markdown-link-footer:hover) {
  color: var(--vp-c-text-1);
}
</style>
