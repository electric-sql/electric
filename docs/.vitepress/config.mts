import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  lang: 'en',
  title: "Electric Next",
  description: "Your data, in sync, wherever you need it.",
  appearance: 'force-dark',
  base: '/',
  cleanUrls: true,
  ignoreDeadLinks: 'localhostLinks',
  head: [
    ['link', {
      rel: 'icon',
      type: 'image/svg+xml',
      href: '/img/brand/favicon.svg'
    }]
  ],
  // https://vitepress.dev/reference/default-theme-config
  themeConfig: {
    logo: '/img/brand/logo.svg',
    nav: [
      { text: 'About', link: '/about' },
      { text: 'Product', link: '/product/electric', activeMatch: '/product/' },
      { text: 'Guides', link: '/guides/quickstart', activeMatch: '/guides/'},
      { text: 'API', link: '/api/http', activeMatch: '/api/'},
      { text: 'Examples', link: '/examples/basic', activeMatch: '/examples/'},
    ],
    sidebar: [
      {
        text: 'About',
        items: [
          { text: '<code>electric-next</code>', link: '/about' }
        ]
      },
      {
        text: 'Product',
        items: [
          { text: 'Electric', link: '/product/electric' },
          { text: 'DDN', link: '/product/ddn' },
          { text: 'PGlite', link: '/product/pglite' },
        ]
      },
      {
        text: 'Guides',
        items: [
          { text: 'Quickstart', link: '/guides/quickstart' },
          // { text: 'Usage', link: '/guides/usage' },
          { text: 'Shapes', link: '/guides/shapes' },
          // { text: 'Deployment', link: '/guides/deployment' },
          { text: 'Writing clients', link: '/guides/write-your-own-client' }
        ]
      },
      {
        text: 'API',
        items: [
          { text: 'HTTP', link: '/api/http' },
          {
            text: 'Clients',
            items: [
              { text: 'TypeScript', link: '/api/clients/typescript' },
              { text: 'Elixir', link: '/api/clients/elixir' },
            ],
            collapsed: false
          },
          {
            text: 'Connectors',
            items: [
              // { text: 'MobX', link: '/api/connectors/mobx' },
              { text: 'React', link: '/api/connectors/react' },
              { text: 'Redis', link: '/api/connectors/redis' },
              // { text: 'TanStack', link: '/api/connectors/tanstack' },
            ],
            collapsed: false
          }
        ]
      }
    ],
    siteTitle: false,
    socialLinks: [
      { icon: 'discord', link: 'https://discord.electric-sql.com' },
      { icon: 'github', link: 'https://github.com/electric-sql/electric-next' }
    ]
  }
})
