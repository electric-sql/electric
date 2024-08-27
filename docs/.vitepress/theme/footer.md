<style scoped>
  .VPFooter {
    position: relative;
    z-index: var(--vp-z-index-footer);
    border-top: 1px solid var(--vp-c-gutter);
    padding: 32px 24px;
    background-color: var(--vp-c-bg);
    margin-bottom: 0.5rem;
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
    flex-direction: row;
    justify-content: center;
  }
  .VPFooter .footer-nav-inner {
    flex-direction: row;
    align-items: center;
    margin: 0.2rem 0;
  }
  @media (max-width: 449px) {
    .VPFooter p.footer-nav {
      flex-direction: column;
    }
  }
  .VPFooter p.footer-nav a {
    margin: 0.3rem;
  }
  .VPFooter p.footer-nav .vpi-social-github,
  .VPFooter p.footer-nav .vpi-social-discord {
    display: inline-block;
    width: 1.24rem;
    height: 1.24rem;
    position: relative;
  }
  .VPFooter p.footer-nav .vpi-social-github,
  .VPFooter p.footer-nav .vpi-social-discord {
    margin: 2px 4px -5px 0;
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
</style>

<footer class="VPFooter">
  <div class="container">
    <p class="footer-logo">
      <img src="/img/brand/logo.svg">
    </p>
    <p class="footer-nav message">
      <span class="footer-nav-inner">
        <a href="/about">
          About</a>
        <a href="/about/community">
          Community</a>
        <a href="/about/contact">
          Contact</a>&nbsp;
      </span>
      <span class="footer-nav-inner">
        <a href="/guides">
          Docs</a>
        <a href="/about/terms">
          Legal</a>&nbsp;
        <a href="https://github.com/electric-sql">
          <span class="vpi-social-github"></span></a>
        <a href="https://discord.electric-sql.com">
          <span class="vpi-social-discord"></span></a>
      </span>
    </p>
    <p class="copyright">
      Released under the
      <a href="https://github.com/electric-sql/electric/blob/main/LICENSE" target="_blank">
        Apache 2.0</a>
      License.
      <span class="no-wrap">
        Copyright © 2024
        <a href="https://find-and-update.company-information.service.gov.uk/company/13573370" target="_blank">
          ElectricSQL</a>.
      </span>
    </p>
  </div>
</footer>