<style scoped>
  .VPFooter {
    position: relative;
    z-index: var(--vp-z-index-footer);
    border-top: 1px solid var(--vp-sidebar-bg-color);
    padding: 80px 24px 32px !important;
/*    background-color: black;*/
    margin-bottom: 0.5rem;
    display: block;
  }

  .VPFooter.has-sidebar {
    display: none;
  }

  .VPFooter :deep(a) {
    text-decoration-line: underline;
    text-underline-offset: 2px;
    transition: color 0.25s;
  }

  .VPFooter :deep(a:hover) {
    color: var(--vp-c-text-1);
  }

  @media (min-width: 768px) {
    .VPFooter {
      padding: 32px;
    }
  }

  .container {
    margin: 0 auto;
    max-width: var(--vp-layout-max-width);
    text-align: center;
  }

  .message,
  .copyright {
    line-height: 24px;
    font-size: 14px;
    font-weight: 500;
    color: var(--vp-c-text-2);
  }

  .VPFooter p {
  margin-bottom: 12px;
  }
  .VPFooter p.footer-nav {
    display: flex;
    flex-direction: column;
    justify-content: center;
    margin-bottom: 0.9rem;
  }
  .VPFooter .footer-nav-inner {
    flex-direction: row;
    align-items: center;
    margin: 0.3rem 0 0.7rem;
  }
  @media (max-width: 449px) {
    .VPFooter p.footer-nav {
      flex-direction: column;
    }
  }
  .VPFooter p.footer-nav a {
    margin: 0.3rem 0.5rem 0.5rem 0.5rem;
  }
  .VPFooter p.footer-nav .vpi-social-tanstack,
  .VPFooter p.footer-nav .vpi-social-pglite,
  .VPFooter p.footer-nav .vpi-social-x,
  .VPFooter p.footer-nav .vpi-social-bluesky,
  .VPFooter p.footer-nav .vpi-social-discord,
  .VPFooter p.footer-nav .vpi-social-github {
    display: inline-block;
    width: 1.24rem;
    height: 1.24rem;
    position: relative;
  }
  @media (max-width: 599px) {
    .VPFooter p.footer-nav .vpi-social-tanstack,
    .VPFooter p.footer-nav .vpi-social-pglite,
    .VPFooter p.footer-nav .vpi-social-x,
    .VPFooter p.footer-nav .vpi-social-bluesky,
    .VPFooter p.footer-nav .vpi-social-discord,
    .VPFooter p.footer-nav .vpi-social-github {
      color: var(--vp-c-text-1);
    }
  }
  .VPFooter p.footer-nav .vpi-social-tanstack,
  .VPFooter p.footer-nav .vpi-social-pglite,
  .VPFooter p.footer-nav .vpi-social-x,
  .VPFooter p.footer-nav .vpi-social-bluesky,
  .VPFooter p.footer-nav .vpi-social-discord,
  .VPFooter p.footer-nav .vpi-social-github {
    margin: 2px 4px -5px 0;
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

  .VPFooter .footer-logo {
    text-align: center;
    width: 100%;
  }
  .VPFooter .footer-logo img {
    width: 108px;
    margin: 12px auto;
  }
  .VPFooter a {
    text-decoration: none !important;
    color: var(--vp-c-indigo-1);
  }

  .footer-nav-inner a .social-name {
    color: var(--vp-c-text-1);
    margin-left: 0.2rem;
  }
  @media (max-width: 599px) {
    .footer-nav-inner a .social-name {
      display: none;
    }
  }
</style>

<template>
  <footer class="VPFooter">
    <div class="container">
      <p class="footer-logo">
        <img src="/img/brand/logo.svg">
      </p>
      <p class="footer-nav message">
        <span class="footer-nav-inner">
          <span class="no-wrap">
            <a href="/about/community">
              About</a>
            <a href="/about/contact">
              Contact</a>
            <a href="/about/legal/terms">
              Legal</a>
            <a href="/docs/intro">
              Docs</a>
          </span>
          <span class="no-wrap">
            <a href="/demos">
              Demos</a>
            <a href="/blog">
              Blog</a>
            <a href="https://dashboard.electric-sql.cloud/">
              Sign up</a>
          </span>
        </span>
        <span class="footer-nav-inner">
          <span class="no-wrap">
            <a href="https://tanstack.com/db">
              <span class="vpi-social-tanstack"></span>
              <span class="social-name">TanStack DB</span></a>
            <a href="https://pglite.dev">
              <span class="vpi-social-pglite"></span>
              <span class="social-name">PGlite</span></a>
            <a href="https://x.com/ElectricSQL">
              <span class="vpi-social-x"></span>
              <span class="social-name">X</span></a>
          </span>
          <span class="no-wrap">
            <a href="https://bsky.app/profile/electric-sql.com">
              <span class="vpi-social-bluesky"></span>
              <span class="social-name">Bluesky</span></a>
            <a href="https://discord.electric-sql.com">
              <span class="vpi-social-discord"></span>
              <span class="social-name">Discord</span></a>
            <a href="https://github.com/electric-sql">
              <span class="vpi-social-github"></span>
              <span class="social-name">GitHub</span></a>
          </span>
        </span>
      </p>
      <p class="copyright">
        Released under the
        <a href="https://github.com/electric-sql/electric/blob/main/LICENSE" target="_blank">
          Apache 2.0</a>
        License.
        <span class="no-wrap">
          © {{ new Date().getFullYear() }}
          Electric DB Inc.
        </span>
      </p>
    </div>
  </footer>
</template>