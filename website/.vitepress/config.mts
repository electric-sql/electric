import fs from 'node:fs'
import { defineConfig } from 'vitepress'
import { tabsMarkdownPlugin } from 'vitepress-plugin-tabs'

import demosData from '../data/demos.data.ts'
import postsData from '../data/posts.data.ts'

const demoPaths = fs.readdirSync('demos').filter(x => x.endsWith('.md')).map(x => `demos/${x}`)
const { demos, examples } = await demosData.load(demoPaths)

const demoSidebarItems = await demos.map(demo => ({
  text: demo.title,
  link: demo.link
}))
const exampleSidebarItems = await examples.map(example => ({
  text: example.title,
  link: example.link
}))

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
      type: 'image/png',
      href: '/img/brand/favicon.png'
    }],
    ['link', {
      rel: 'icon',
      type: 'image/svg+xml',
      href: '/img/brand/favicon.svg'
    }],
    ['script', {
      defer: 'defer',
      'data-domain': 'electric-sql.com',
      src: 'https://plausible.io/js/script.js',
    }]
  ],
  ignoreDeadLinks: 'localhostLinks',
  markdown: {
    theme: 'github-dark',
    languages: [
      'css',
      'elixir',
      'html',
      'javascript',
      'jsx',
      'nginx',
      'shellscript',
      'sql',
      'tsx',
      'typescript'
    ],
    config(md) {
      md.use(tabsMarkdownPlugin)
    }
  },
  rewrites(id) {
    if (id.startsWith('blog/posts')) {
      // 'blog/posts/:year-:month-:day-:slug.md': 'blog/:year/:month/:day/:slug.md'
      return id.replace(
        /^blog\/posts\/(2[0-9][0-9][0-9])-([0-9][0-9])-([0-9][0-9])-(.*)/,
        'blog/$1/$2/$3/$4'
      )
    }
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
      { text: 'Use cases', link: '/use-cases/data-sync', activeMatch: '/use-cases/' },
      { text: 'Docs', link: '/docs/intro', activeMatch: '/docs/'},
      { text: 'Demos', link: '/demos', activeMatch: '/demos'},
      { text: 'Blog', link: '/blog', activeMatch: '/blog'},
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
            { text: 'Cloud', link: '/product/cloud', items: [
                { text: 'Sign-up', link: '/product/cloud/sign-up' },
                { text: 'Onboarding', link: '/product/cloud/onboarding' }
              ]
            },
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
              link: '/use-cases/data-sync'
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
            { text: 'Writes', link: '/docs/guides/writes' },
            { text: 'Installation', link: '/docs/guides/installation' },
            { text: 'Deployment', link: '/docs/guides/deployment' },
            { text: 'Security', link: '/docs/guides/security' },
            { text: 'Troubleshooting', link: '/docs/guides/troubleshooting' },
            { text: 'Client development', link: '/docs/guides/client-development' },
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
            { text: 'Config', link: '/docs/api/config' }
          ]
        },
        {
          text: 'Integrations',
          collapsed: false,
          items: [
            {
              text: 'Frameworks',
              items: [
                { text: 'LiveStore', link: '/docs/integrations/livestore' },
                { text: 'MobX', link: '/docs/integrations/mobx' },
                { text: 'Next.js', link: '/docs/integrations/next' },
                { text: 'Phoenix', link: '/docs/integrations/phoenix' },
                { text: 'React', link: '/docs/integrations/react' },
                { text: 'Redis', link: '/docs/integrations/redis' },
                { text: 'TanStack', link: '/docs/integrations/tanstack' },
                { text: 'Yjs', link: '/docs/integrations/yjs' },
              ],
            },
            {
              text: 'Platforms',
              items: [
                { text: 'AWS', link: '/docs/integrations/aws' },
                { text: 'Cloudflare', link: '/docs/integrations/cloudflare' },
                { text: 'Crunchy', link: '/docs/integrations/crunchy' },
                { text: 'Digital Ocean', link: '/docs/integrations/digital-ocean' },
                { text: 'Expo', link: '/docs/integrations/expo' },
                { text: 'Fly.io', link: '/docs/integrations/fly' },
                { text: 'GCP', link: '/docs/integrations/gcp' },
                { text: 'Neon', link: '/docs/integrations/neon' },
                { text: 'Netlify', link: '/docs/integrations/netlify' },
                { text: 'Render', link: '/docs/integrations/render' },
                { text: 'Supabase', link: '/docs/integrations/supabase' }
              ]
            }
          ]
        },
        {
          text: 'Reference',
          collapsed: false,
          items: [
            { text: 'Alternatives', link: '/docs/reference/alternatives' },
            { text: 'Benchmarks', link: '/docs/reference/benchmarks' },
            { text: 'Literature', link: '/docs/reference/literature' },
            { text: 'Telemetry', link: '/docs/reference/telemetry' },
          ]
        },
      ],
      '/demos': [
        {
          text: 'Demos',
          collapsed: false,
          items: demoSidebarItems
        },
        {
          text: 'Examples',
          collapsed: false,
          items: exampleSidebarItems,
        }
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
            {
              text: 'Jobs',
              link: '/about/jobs',
              items: [
                { text: 'PGlite Engineer', link: '/about/jobs/pglite-engineer' }
              ],
              collapsed: false
            },
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
      { icon: 'pglite', link: 'https://pglite.dev' },
      { icon: 'github', link: 'https://github.com/electric-sql/electric' },
      { icon: 'bluesky', link: 'https://bsky.app/profile/electric-sql.com' },
      { icon: 'discord', link: 'https://discord.electric-sql.com' }
    ]
  },
  transformHead: ({ pageData, siteData }) => {
    const fm = pageData.frontmatter
    const head = []

    const title = `${fm.title || siteData.title} | ${fm.titleTemplate || 'ElectricSQL'}`
    const description = fm.description || siteData.description
    const image = `https://electric-sql.com${fm.image || '/img/meta/why-fetch-when-you-can-sync.jpg'}`

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
