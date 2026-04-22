import { defineConfig } from 'vitepress'
import { tabsMarkdownPlugin } from 'vitepress-plugin-tabs'
import llmstxt from 'vitepress-plugin-llms'
import type { LanguageRegistration } from 'shiki'

import caddyfileGrammar from './theme/syntax/caddyfile.json'

import { buildMetaImageUrl } from '../src/lib/meta-image'

const caddyfileLanguage: LanguageRegistration = {
  ...caddyfileGrammar,
  name: 'caddyfile',
  aliases: ['caddy', 'Caddyfile'],
}

const resourcesSidebar = [
  {
    text: 'Resources',
    items: [
      { text: 'Blog', link: '/blog' },
      { text: 'Community', link: '/about/community' },
      { text: 'Team', link: '/about/team' },
      { text: 'LLMs / AGENTS.md', link: '/llms' },
      {
        text: 'Legal',
        items: [
          { text: 'Terms', link: '/about/legal/terms' },
          { text: 'Privacy', link: '/about/legal/privacy' },
        ],
        collapsed: false,
      },
      { text: 'Contact', link: '/about/contact' },
    ],
  },
]

// https://vitepress.dev/reference/site-config
export default defineConfig({
  vite: {
    define: {
      // Expose Netlify environment variables to the client
      'import.meta.env.DEPLOY_PRIME_URL': JSON.stringify(
        process.env.DEPLOY_PRIME_URL || ''
      ),
    },
    plugins: [
      llmstxt({
        generateLLMsFullTxt: false,
        customLLMsTxtTemplate: `\
# {title}

{description}

{details}

> [!IMPORTANT] Instructions for coding agents
> Coding agents should read [AGENTS.md](/AGENTS.md) for instructions and guidance.

## Table of Contents

{toc}`,
        ignoreFiles: [
          'blog/posts/2022*',
          'blog/posts/2023*',
          'blog/posts/2024-01-*',
          'blog/posts/2024-02-*',
          'blog/posts/2024-03-*',
          'blog/posts/2024-04-*',
          'blog/posts/2024-05-*',
          'blog/posts/2024-06-*',
        ],
      }),
    ],
  },
  lang: 'en',
  title: 'Electric',
  description:
    "Electric provides the data primitives and infra to build collaborative, multi-agent systems. Including Postgres Sync, Durable Streams, TanStack DB and PGlite.",
  appearance: 'dark',
  base: '/',
  cleanUrls: true,
  head: [
    [
      'link',
      {
        rel: 'icon',
        type: 'image/png',
        href: '/img/brand/favicon.png',
      },
    ],
    [
      'link',
      {
        rel: 'icon',
        type: 'image/svg+xml',
        href: '/img/brand/favicon.svg',
      },
    ],
    [
      'link',
      {
        rel: 'prerender',
        href: 'https://airtable.com/embed/appDitPIpjlAxK7CL/pagrWjq3qw5Fp68Wa/form',
      },
    ],
    [
      'script',
      {
        defer: 'defer',
        'data-domain': 'electric-sql.com',
        src: 'https://plausible.io/js/script.js',
      },
    ],
  ],
  ignoreDeadLinks: [
    /localhost/,
    /^\/AGENTS(\.md)?$/,
    /^\/cloud$/,
    // Legacy /docs/* paths handled by Netlify redirects to /docs/sync/*
    /^\/docs\/(intro|quickstart|stacks)(\/|$|#)/,
    /^\/docs\/(guides|api|integrations|reference)\//,
    // Bare paths to dirs with index.md (vitepress dead-link checker needs trailing slash)
    /^\/sync$/,
    /^\/streams$/,
    /^\/agents$/,
    /^\/docs\/sync$/,
    /^\/docs\/agents$/,
    /^\/docs\/streams$/,
    // Legacy /demos/* paths handled by Netlify redirects to /sync/demos/*
    /^\/demos(\/|$|#)/,
  ],
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
      'typescript',
      caddyfileLanguage
    ],
    config(md) {
      md.use(tabsMarkdownPlugin)
    },
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
    hostname: 'https://electric-sql.com',
  },
  // https://vitepress.dev/reference/default-theme-config
  themeConfig: {
    editLink: {
      pattern:
        'https://github.com/electric-sql/electric/edit/main/website/:path',
    },
    logo: { light: '/img/brand/logo.inverse.svg', dark: '/img/brand/logo.svg' },
    nav: [],
    search: {
      provider: 'local',
    },
    sidebar: {
      '/cloud/': [
        // Title-button + primary links (Usage, CLI) at the top of
        // the sidebar are rendered by `DocsSidebarHero.vue` (mounted
        // via the `sidebar-nav-before` slot in Layout.vue), so the
        // sidebar has no further groups for Cloud.
      ],
      '/sync/': [
        {
          text: 'Electric Sync',
          items: [
            { text: 'Overview', link: '/sync' },
            { text: 'Demos', link: '/sync/demos/' },
          ],
        },
        {
          text: 'Client primitives',
          items: [
            { text: 'TanStack DB', link: '/sync/tanstack-db' },
            { text: 'PGlite', link: '/sync/pglite' },
          ],
        },
      ],
      '/docs/sync': [
        // Title-button + primary links (Overview, Quickstart, Stacks)
        // at the top of the sidebar are rendered by
        // `DocsSidebarHero.vue` (mounted via `sidebar-nav-before` in
        // Layout.vue), so the sidebar starts directly with `Guides`.
        {
          text: 'Guides',
          collapsed: false,
          items: [
            { text: 'Auth', link: '/docs/sync/guides/auth' },
            { text: 'Shapes', link: '/docs/sync/guides/shapes' },
            { text: 'Writes', link: '/docs/sync/guides/writes' },
            { text: 'Installation', link: '/docs/sync/guides/installation' },
            {
              text: 'PostgreSQL Permissions',
              link: '/docs/sync/guides/postgres-permissions',
            },
            { text: 'Deployment', link: '/docs/sync/guides/deployment' },
            { text: 'Upgrading', link: '/docs/sync/guides/upgrading' },
            { text: 'Sharding', link: '/docs/sync/guides/sharding' },
            { text: 'Security', link: '/docs/sync/guides/security' },
            {
              text: 'Troubleshooting',
              link: '/docs/sync/guides/troubleshooting',
            },
            {
              text: 'Client development',
              link: '/docs/sync/guides/client-development',
            },
          ],
        },
        {
          text: 'API',
          collapsed: false,
          items: [
            { text: 'HTTP', link: '/docs/sync/api/http' },
            {
              text: 'Clients',
              items: [
                {
                  text: 'TypeScript',
                  link: '/docs/sync/api/clients/typescript',
                },
                { text: 'Elixir', link: '/docs/sync/api/clients/elixir' },
              ],
              collapsed: false,
            },
            { text: 'Config', link: '/docs/sync/api/config' },
          ],
        },
        {
          text: 'Integrations',
          collapsed: false,
          items: [
            {
              text: 'Frameworks',
              items: [
                {
                  text: 'LiveStore',
                  link: '/docs/sync/integrations/livestore',
                },
                { text: 'MobX', link: '/docs/sync/integrations/mobx' },
                { text: 'Next.js', link: '/docs/sync/integrations/next' },
                { text: 'Phoenix', link: '/docs/sync/integrations/phoenix' },
                { text: 'React', link: '/docs/sync/integrations/react' },
                { text: 'Redis', link: '/docs/sync/integrations/redis' },
                { text: 'TanStack', link: '/docs/sync/integrations/tanstack' },
                { text: 'Yjs', link: '/docs/sync/integrations/yjs' },
              ],
            },
            {
              text: 'Platforms',
              items: [
                { text: 'AWS', link: '/docs/sync/integrations/aws' },
                {
                  text: 'Cloudflare',
                  link: '/docs/sync/integrations/cloudflare',
                },
                { text: 'Crunchy', link: '/docs/sync/integrations/crunchy' },
                {
                  text: 'Digital Ocean',
                  link: '/docs/sync/integrations/digital-ocean',
                },
                { text: 'Expo', link: '/docs/sync/integrations/expo' },
                { text: 'Fly.io', link: '/docs/sync/integrations/fly' },
                { text: 'GCP', link: '/docs/sync/integrations/gcp' },
                { text: 'Neon', link: '/docs/sync/integrations/neon' },
                { text: 'Netlify', link: '/docs/sync/integrations/netlify' },
                {
                  text: 'PlanetScale',
                  link: '/docs/sync/integrations/planetscale',
                },
                { text: 'Render', link: '/docs/sync/integrations/render' },
                { text: 'Supabase', link: '/docs/sync/integrations/supabase' },
              ],
            },
          ],
        },
        {
          text: 'Reference',
          collapsed: false,
          items: [
            {
              text: 'Alternatives',
              link: '/docs/sync/reference/alternatives',
            },
            { text: 'Benchmarks', link: '/docs/sync/reference/benchmarks' },
            { text: 'Literature', link: '/docs/sync/reference/literature' },
            { text: 'Telemetry', link: '/docs/sync/reference/telemetry' },
          ],
        },
        {
          text: 'Client primitives',
          collapsed: false,
          items: [
            { text: 'TanStack DB', link: '/sync/tanstack-db' },
            { text: 'PGlite', link: '/sync/pglite' },
          ],
        },
      ],
      '/docs/agents': [
        // Title-button + primary links (Overview, Quickstart) at the
        // top of the sidebar are rendered by `DocsSidebarHero.vue`
        // (mounted via `sidebar-nav-before` in Layout.vue), so the
        // sidebar starts directly with `Usage`.
        {
          text: 'Usage',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/docs/agents/usage/overview' },
            {
              text: 'Defining entities',
              link: '/docs/agents/usage/defining-entities',
            },
            {
              text: 'Writing handlers',
              link: '/docs/agents/usage/writing-handlers',
            },
            {
              text: 'Configuring the agent',
              link: '/docs/agents/usage/configuring-the-agent',
            },
            {
              text: 'Defining tools',
              link: '/docs/agents/usage/defining-tools',
            },
            {
              text: 'Managing state',
              link: '/docs/agents/usage/managing-state',
            },
            {
              text: 'Spawning and coordinating',
              link: '/docs/agents/usage/spawning-and-coordinating',
            },
            { text: 'Shared state', link: '/docs/agents/usage/shared-state' },
            { text: 'App setup', link: '/docs/agents/usage/app-setup' },
            { text: 'Testing', link: '/docs/agents/usage/testing' },
          ],
        },
        {
          text: 'Reference',
          collapsed: false,
          items: [
            { text: 'CLI', link: '/docs/agents/reference/cli' },
            {
              text: 'Handler context',
              link: '/docs/agents/reference/handler-context',
            },
            {
              text: 'Entity definition',
              link: '/docs/agents/reference/entity-definition',
            },
            {
              text: 'Agent config',
              link: '/docs/agents/reference/agent-config',
            },
            { text: 'Agent tool', link: '/docs/agents/reference/agent-tool' },
            {
              text: 'State collection proxy',
              link: '/docs/agents/reference/state-collection-proxy',
            },
            {
              text: 'Entity handle',
              link: '/docs/agents/reference/entity-handle',
            },
            {
              text: 'Shared state handle',
              link: '/docs/agents/reference/shared-state-handle',
            },
            { text: 'Wake event', link: '/docs/agents/reference/wake-event' },
            {
              text: 'Built-in collections',
              link: '/docs/agents/reference/built-in-collections',
            },
            {
              text: 'Entity registry',
              link: '/docs/agents/reference/entity-registry',
            },
            {
              text: 'Runtime handler',
              link: '/docs/agents/reference/runtime-handler',
            },
          ],
        },
        {
          text: 'Entities',
          collapsed: false,
          items: [
            {
              text: 'Agents',
              items: [
                { text: 'Chat', link: '/docs/agents/entities/agents/chat' },
                {
                  text: 'Researcher',
                  link: '/docs/agents/entities/agents/researcher',
                },
                { text: 'Coder', link: '/docs/agents/entities/agents/coder' },
                {
                  text: 'Worker',
                  link: '/docs/agents/entities/agents/worker',
                },
              ],
              collapsed: false,
            },
            {
              text: 'Patterns',
              items: [
                {
                  text: 'Manager / worker',
                  link: '/docs/agents/entities/patterns/manager-worker',
                },
                {
                  text: 'Pipeline',
                  link: '/docs/agents/entities/patterns/pipeline',
                },
                {
                  text: 'Map / reduce',
                  link: '/docs/agents/entities/patterns/map-reduce',
                },
                {
                  text: 'Dispatcher',
                  link: '/docs/agents/entities/patterns/dispatcher',
                },
                {
                  text: 'Blackboard',
                  link: '/docs/agents/entities/patterns/blackboard',
                },
                {
                  text: 'Reactive observers',
                  link: '/docs/agents/entities/patterns/reactive-observers',
                },
              ],
              collapsed: false,
            },
          ],
        },
        {
          text: 'Examples',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/docs/agents/examples/' },
            { text: 'Playground', link: '/docs/agents/examples/playground' },
            { text: 'Mega Draw', link: '/docs/agents/examples/mega-draw' },
            { text: 'Grid app', link: '/docs/agents/examples/grid-app' },
          ],
        },
      ],
      '/docs/streams': [
        // Title-button + primary links (Overview, Quickstart) at the
        // top of the sidebar are rendered by `DocsSidebarHero.vue`
        // (mounted via `sidebar-nav-before` in Layout.vue), so the
        // sidebar starts directly with `Usage`.
        {
          text: 'Usage',
          collapsed: false,
          items: [
            { text: 'CLI', link: '/docs/streams/cli' },
            {
              text: 'Clients',
              collapsed: false,
              items: [
                {
                  text: 'TypeScript',
                  link: '/docs/streams/clients/typescript',
                },
                { text: 'Python', link: '/docs/streams/clients/python' },
                {
                  text: 'Other clients',
                  link: '/docs/streams/clients/other',
                },
              ],
            },
            { text: 'JSON mode', link: '/docs/streams/json-mode' },
            { text: 'Durable Proxy', link: '/docs/streams/durable-proxy' },
            { text: 'Durable State', link: '/docs/streams/durable-state' },
            { text: 'StreamDB', link: '/docs/streams/stream-db' },
            { text: 'StreamFS', link: '/docs/streams/stream-fs' },
          ],
        },
        {
          text: 'Integrations',
          collapsed: false,
          items: [
            {
              text: 'TanStack AI',
              link: '/docs/streams/integrations/tanstack-ai',
            },
            {
              text: 'Vercel AI SDK',
              link: '/docs/streams/integrations/vercel-ai-sdk',
            },
            { text: 'Yjs', link: '/docs/streams/integrations/yjs' },
            {
              text: 'AnyCable',
              link: 'https://docs.anycable.io/anycable-go/durable_streams',
            },
          ],
        },
        {
          text: 'Reference',
          collapsed: false,
          items: [
            { text: 'Deployment', link: '/docs/streams/deployment' },
            {
              text: 'Building a client',
              link: '/docs/streams/building-a-client',
            },
            {
              text: 'Building a server',
              link: '/docs/streams/building-a-server',
            },
            { text: 'Benchmarking', link: '/docs/streams/benchmarking' },
            {
              text: 'Protocol',
              link: 'https://github.com/durable-streams/durable-streams/blob/main/PROTOCOL.md',
            },
          ],
        },
      ],
      '/about': resourcesSidebar,
      '/llms': resourcesSidebar,
    },
    siteTitle: false,
    socialLinks: [],
  },
  transformHead: ({ pageData, siteData }) => {
    const fm = pageData.frontmatter
    const head = []

    const pageTitle = fm.title || siteData.title
    const titleTemplate = fm.titleTemplate || ':title | ElectricSQL'
    const title = titleTemplate.replace(':title', pageTitle)
    const description = fm.description || siteData.description

    const PRODUCTION_URL = 'https://electric-sql.com'
    const LOCAL_DEV_URL = 'http://localhost:5173'
    const DEFAULT_IMAGE = '/img/meta/electric-sync-primitives.jpg'

    const siteOrigin =
      process.env.CONTEXT === 'production'
        ? process.env.URL || PRODUCTION_URL
        : process.env.DEPLOY_PRIME_URL ||
          (process.env.NODE_ENV === 'development'
            ? LOCAL_DEV_URL
            : PRODUCTION_URL)

    const image = buildMetaImageUrl(fm.image || DEFAULT_IMAGE, siteOrigin)

    head.push(['meta', { name: 'twitter:card', content: 'summary_large_image' }])
    head.push(['meta', { name: 'twitter:site', content: '@ElectricSQL' }])
    head.push(['meta', { name: 'twitter:title', content: title }])
    head.push(['meta', { name: 'twitter:description', content: description }])
    head.push(['meta', { name: 'twitter:image', content: image }])
    head.push(['meta', { property: 'og:title', content: title }])
    head.push(['meta', { property: 'og:description', content: description }])
    head.push(['meta', { property: 'og:image', content: image }])

    return head
  },
  transformPageData(pageData) {
    pageData.frontmatter.editLink = pageData.relativePath.startsWith('docs')
  },
})
