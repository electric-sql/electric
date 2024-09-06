import fs from 'node:fs'
import { defineConfig } from 'vitepress'

import postsData from '../data/posts.data.ts'

const postPaths = fs.readdirSync('blog/posts').filter(x => x.endsWith('.md')).map(x => `blog/posts/${x}`)

const posts = await postsData.load(postPaths)

const blogSidebarItems = await posts.map(post => ({
  text: post.title,
  link: post.path
}))

// https://vitepress.dev/reference/site-config
export default defineConfig({
  lang: 'en',
  title: "ElectricSQL",
  description: "Sync little subsets of your Postgres data into local apps and services.",
  appearance: 'force-dark',
  base: '/',
  cleanUrls: true,
  head: [
    ['link', {
      rel: 'icon',
      type: 'image/svg+xml',
      href: '/img/brand/favicon.svg'
    }]
  ],
  ignoreDeadLinks: 'localhostLinks',
  markdown: {
    theme: 'github-dark',
    languages: [
      'elixir',
      'html',
      'css',
      'javascript',
      'jsx',
      'shellscript',
      'sql',
      'tsx',
      'typescript'
    ]
  },
  rewrites: {
    'blog/posts/:year-:month-:day-:slug.md': 'blog/:year/:month/:day/:slug.md'
  },
  sitemap: {
    hostname: 'https://electric-sql.com'
  },
  // https://vitepress.dev/reference/default-theme-config
  themeConfig: {
    editLink: {
      pattern:
        'https://github.com/electric-sql/electric/edit/main/website/:path',
    },
    logo: '/img/brand/logo.svg',
    nav: [
      { text: 'Product', link: '/product/electric', activeMatch: '/product/' },
      { text: 'Use cases', link: '/use-cases/state-transfer', activeMatch: '/use-cases/' },
      { text: 'Docs', link: '/docs/intro', activeMatch: '/docs/'},
      { text: 'Blog', link: '/blog', activeMatch: '/blog/'},
      { text: 'About', link: '/about/community', activeMatch: '/about/'}
    ],
    search: {
      provider: 'local'
    },
    sidebar: {
      '/product': [
        {
          text: 'Product',
          items: [
            { text: 'Electric', link: '/product/electric' },
            { text: 'DDN', link: '/product/ddn' },
            { text: 'PGlite', link: '/product/pglite' },
          ]
        }
      ],
      '/use-cases': [
        {
          text: 'Use cases',
          items: [
            {
              text: 'Replace data fetching with data sync',
              link: '/use-cases/state-transfer'
            },
            {
              text: 'Build resilient software that works offline',
              link: '/use-cases/local-first-software'
            },
            // {
            //   text: 'Provision data into dev and test environments',
            //   link: '/use-cases/dev-and-test'
            // },
            //{
            //  text: 'Add multi-user collaboration to your apps',
            //  link: '/use-cases/multi-user'
            //},
            {
              text: 'Automate cache invalidation',
              link: '/use-cases/cache-invalidation'
            },
            //{
            //  text: 'Hydrating edge workers',
            //  link: '/use-cases/edge-workers'
            //},
            //{
            //  text: 'Partial replicas for distributed cloud services',
            //  link: '/use-cases/cloud-services'
            //},
            {
              text: 'Retrieve data for local AI',
              link: '/use-cases/local-ai'
            },
            {
              text: 'Reduce your cloud costs',
              link: '/use-cases/cloud-costs'
            }
          ]
        }
      ],
      '/docs': [
        {
          text: 'Docs',
          collapsed: false,
          items: [
            { text: 'Intro', link: '/docs/intro' },
            { text: 'Quickstart', link: '/docs/quickstart' },
          ]
        },
        {
          text: 'Guides',
          collapsed: false,
          items: [
            { text: 'Auth', link: '/docs/guides/auth' },
            { text: 'Shapes', link: '/docs/guides/shapes' },
            { text: 'Local development', link: '/docs/guides/local-development' },
            { text: 'Deployment', link: '/docs/guides/deployment' },
            { text: 'Writing your own client', link: '/docs/guides/writing-your-own-client' },
          ]
        },
        {
          text: 'API',
          collapsed: false,
          items: [
            { text: 'HTTP', link: '/docs/api/http' },
            {
              text: 'Clients',
              items: [
                { text: 'TypeScript', link: '/docs/api/clients/typescript' },
                { text: 'Elixir', link: '/docs/api/clients/elixir' },
              ],
              collapsed: false
            },
            {
              text: 'Integrations',
              items: [
                // { text: 'MobX', link: '/docs/api/integrations/mobx' },
                { text: 'React', link: '/docs/api/integrations/react' },
                // { text: 'Redis', link: '/docs/api/integrations/redis' },
                // { text: 'TanStack', link: '/docs/api/integrations/tanstack' },
              ],
              collapsed: false
            }
          ]
        },
        {
          text: 'Reference',
          collapsed: true,
          items: [
            { text: 'Alternatives', link: '/docs/reference/alternatives' },
            { text: 'Literature', link: '/docs/reference/literature' },
            { text: 'Telemetry', link: '/docs/reference/telemetry' },
          ]
        },
      ],
      '/blog': [
        {
          text: 'Blog',
          items: blogSidebarItems
        },
      ],
      '/about': [
        {
          text: 'About',
          items: [
            { text: 'Community', link: '/about/community' },
            { text: 'Team', link: '/about/team' },
            { text: 'Jobs', link: '/about/jobs' },
            {
              text: 'Legal',
              items: [
                { text: 'Terms', link: '/about/legal/terms' },
                { text: 'Privacy', link: '/about/legal/privacy' },
                { text: 'Cookies', link: '/about/legal/cookies' },
              ],
              collapsed: false
            },
            { text: 'Contact', link: '/about/contact' }
          ]
        },
      ]
    },
    siteTitle: false,
    socialLinks: [
      { icon: 'discord', link: 'https://discord.electric-sql.com' },
      { icon: 'github', link: 'https://github.com/electric-sql' }
    ]
  },
  transformHead: ({ pageData, siteData }) => {
    const fm = pageData.frontmatter
    const head = []

    const title = `${fm.title || siteData.title} | ${fm.titleTemplate || 'ElectricSQL'}`
    const description = fm.description || siteData.description
    const image = `https://electric-sql.com${fm.image || '/img/postgres-sync.jpg'}`

    head.push(['meta', { name: 'twitter:card', content: 'summary_large_image' }])
    head.push(['meta', { name: 'twitter:image', content: image }])
    head.push(['meta', { property: 'og:title', content: title }])
    head.push(['meta', { property: 'og:description', content: description }])
    head.push(['meta', { property: 'og:image', content: image }])

    return head
  },
  transformPageData(pageData) {
    pageData.frontmatter.editLink = pageData.relativePath.startsWith('docs')
  }
})
