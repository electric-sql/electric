import { defineConfig, type HeadConfig, type MarkdownOptions } from 'vitepress'
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tabsMarkdownPlugin } from 'vitepress-plugin-tabs'
import llmstxt from 'vitepress-plugin-llms'
import type { LanguageRegistration } from 'shiki'
import type { Plugin, ViteDevServer } from 'vite'

import caddyfileGrammar from './theme/syntax/caddyfile.json'
import { exportMarkedPagesToMarkdown } from './markdown-export'

import { buildMetaImageUrl } from '../src/lib/meta-image'

const MARKDOWN_EXPORT = process.env.MARKDOWN_EXPORT === '1'
const WEBSITE_ROOT = dirname(dirname(fileURLToPath(import.meta.url))).replace(
  /\\/g,
  '/'
)

function toVitePressSourceId(id: string): string {
  const normalized = id.replace(/\\/g, '/')
  const root = `${WEBSITE_ROOT.replace(/\/$/, '')}/`

  return normalized.startsWith(root) ? normalized.slice(root.length) : normalized
}

function resolveFromWebsiteRoot(filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(WEBSITE_ROOT, filePath)
}

function markdownAssetCandidates(relativePath: string): string[] {
  if (!relativePath.endsWith('.md') || relativePath.endsWith('/index.md')) {
    return [relativePath]
  }

  return [relativePath, relativePath.replace(/\.md$/, '/index.md')]
}

function markdownAssetDevServer(): Plugin {
  return {
    name: 'electric-markdown-asset-dev-server',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url ?? ''
        const pathname = rawUrl.split('?')[0]

        // VitePress imports markdown pages as module URLs like
        // `/docs/foo.md?import`. Only serve direct asset requests here;
        // query-string requests must continue through Vite's transform stack.
        if (rawUrl.includes('?') || !pathname.match(/\.(md|txt)$/)) {
          next()
          return
        }

        const relativePath = decodeURIComponent(pathname).replace(/^\/+/, '')
        const vitepressConfig = server.config as typeof server.config & {
          vitepress?: { outDir?: string }
        }
        const outDir = resolveFromWebsiteRoot(
          vitepressConfig.vitepress?.outDir ?? '.vitepress/dist'
        )

        for (const candidate of markdownAssetCandidates(relativePath)) {
          try {
            const content = await readFile(resolve(outDir, candidate), 'utf8')
            res.setHeader('Content-Type', 'text/plain; charset=utf-8')
            res.end(content)
            return
          } catch {
            // Try the next index-page alias candidate.
          }
        }

        res.statusCode = 404
        res.end('Not found')
      })
    },
  }
}

const caddyfileLanguage: LanguageRegistration = {
  ...caddyfileGrammar,
  name: 'caddyfile',
  aliases: ['caddy', 'Caddyfile'],
}

// Order mirrors the `More` nav dropdown (left column then right
// column, omitting the external Discord/GitHub/X social icons and
// Blog — Blog has its own top-level nav entry and listing page).
// Rendered as a flat list with no group heading.
const resourcesSidebar = [
      // Trailing slash is required for the active state to match —
      // VitePress normalizes index-page paths to include the trailing
      // slash (`/about/index.md` → `/about/`), so the sidebar link
      // must too. See `INDEX_OR_EXT_RE` in vitepress/dist/client/shared.js.
      { text: 'About', link: '/about/' },
  { text: 'Community', link: '/about/community' },
  { text: 'Team', link: '/about/team' },
  { text: 'Contact', link: '/about/contact' },
  {
    text: 'Legal',
    items: [
      { text: 'Terms', link: '/about/legal/terms' },
      { text: 'Privacy', link: '/about/legal/privacy' },
    ],
    collapsed: false,
  },
  { text: 'LLMs / AGENTS.md', link: '/llms' },
]

// Shared sidebar for the Sync docs section AND the three sync primitive
// pages at /sync/postgres-sync, /sync/tanstack-db, /sync/pglite. The
// primitive pages are conceptually part of the docs (they sit in the
// `Sync primitives` group at the top of the sidebar) so they render
// with this sidebar rather than the marketing /sync/ sidebar used by
// the top-level landing page and the demos.
const syncDocsSidebar = [
  // Title-button + primary links (Overview, Quickstart, Stacks) at the
  // top of the sidebar are rendered by `DocsSidebarHero.vue` (mounted
  // via `sidebar-nav-before` in Layout.vue), so the sidebar starts
  // directly with the `Sync primitives` group.
  {
    text: 'Sync primitives',
    collapsed: false,
    items: [
      { text: 'Postgres Sync', link: '/sync/postgres-sync' },
      { text: 'TanStack DB', link: '/sync/tanstack-db' },
      { text: 'PGlite', link: '/sync/pglite' },
    ],
  },
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
          { text: 'TypeScript', link: '/docs/sync/api/clients/typescript' },
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
          { text: 'LiveStore', link: '/docs/sync/integrations/livestore' },
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
          { text: 'Cloudflare', link: '/docs/sync/integrations/cloudflare' },
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
          { text: 'PlanetScale', link: '/docs/sync/integrations/planetscale' },
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
      { text: 'Alternatives', link: '/docs/sync/reference/alternatives' },
      { text: 'Benchmarks', link: '/docs/sync/reference/benchmarks' },
      { text: 'Literature', link: '/docs/sync/reference/literature' },
      { text: 'Telemetry', link: '/docs/sync/reference/telemetry' },
    ],
  },
]

// Shared sidebar for the Agents docs section AND the agents demos
// page at /agents/demos. Demo pages live at marketing URLs but are
// conceptually part of the docs — they render with the docs sidebar
// so users can navigate sideways into Usage / Reference / Entities.
// Title-button + primary links (Overview, Quickstart, Demos) are
// rendered by `DocsSidebarHero.vue` (mounted via `sidebar-nav-before`
// in Layout.vue).
const agentsDocsSidebar = [
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
        text: 'Context composition',
        link: '/docs/agents/usage/context-composition',
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
        text: 'Spawning & coordinating',
        link: '/docs/agents/usage/spawning-and-coordinating',
      },
      {
        text: 'Waking entities',
        link: '/docs/agents/usage/waking-entities',
      },
      { text: 'Shared state', link: '/docs/agents/usage/shared-state' },
      {
        text: 'Clients & React',
        link: '/docs/agents/usage/clients-and-react',
      },
      {
        text: 'Programmatic runtime client',
        link: '/docs/agents/usage/programmatic-runtime-client',
      },
      { text: 'App setup', link: '/docs/agents/usage/app-setup' },
      {
        text: 'Embedded built-ins',
        link: '/docs/agents/usage/embedded-builtins',
      },
      { text: 'Testing', link: '/docs/agents/usage/testing' },
    ],
  },
  {
    text: 'Reference',
    collapsed: false,
    items: [
      { text: 'CLI', link: '/docs/agents/reference/cli' },
      {
        text: 'HandlerContext',
        link: '/docs/agents/reference/handler-context',
      },
      {
        text: 'EntityDefinition',
        link: '/docs/agents/reference/entity-definition',
      },
      {
        text: 'AgentConfig',
        link: '/docs/agents/reference/agent-config',
      },
      { text: 'AgentTool', link: '/docs/agents/reference/agent-tool' },
      {
        text: 'StateCollectionProxy',
        link: '/docs/agents/reference/state-collection-proxy',
      },
      {
        text: 'EntityHandle',
        link: '/docs/agents/reference/entity-handle',
      },
      {
        text: 'SharedStateHandle',
        link: '/docs/agents/reference/shared-state-handle',
      },
      { text: 'WakeEvent', link: '/docs/agents/reference/wake-event' },
      {
        text: 'Built-in collections',
        link: '/docs/agents/reference/built-in-collections',
      },
      {
        text: 'EntityRegistry',
        link: '/docs/agents/reference/entity-registry',
      },
      {
        text: 'RuntimeHandler',
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
          { text: 'Horton', link: '/docs/agents/entities/agents/horton' },
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
            text: 'Manager-Worker',
            link: '/docs/agents/entities/patterns/manager-worker',
          },
          {
            text: 'Pipeline',
            link: '/docs/agents/entities/patterns/pipeline',
          },
          {
            text: 'Map-Reduce',
            link: '/docs/agents/entities/patterns/map-reduce',
          },
          {
            text: 'Dispatcher',
            link: '/docs/agents/entities/patterns/dispatcher',
          },
          {
            text: 'Blackboard (shared state)',
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
]

// Compact sidebar for the Agents demos section. The product title,
// Overview / Quickstart / Demos links are rendered above this by
// `DocsSidebarHero.vue`.
const agentsDemosSidebar = [
  {
    text: 'Demo apps',
    collapsed: false,
    items: [
      { text: 'Chat Starter', link: '/agents/demos/chat-starter' },
      { text: 'Deep Survey', link: '/agents/demos/deep-survey' },
    ],
  },
  {
    text: 'Technical examples',
    collapsed: false,
    items: [
      { text: 'Playground', link: '/docs/agents/examples/playground' },
    ],
  },
]

// Compact sidebar for the Sync demos section. The product title,
// Overview / Quickstart / Stacks / Demos links are rendered above
// this by `DocsSidebarHero.vue`; this sidebar only lists the demo
// section content.
const syncDemosSidebar = [
  {
    text: 'Demo apps',
    collapsed: false,
    items: [
      { text: 'Burn', link: '/sync/demos/burn' },
      { text: 'AI Chat', link: '/sync/demos/ai-chat' },
      { text: 'Linearlite', link: '/sync/demos/linearlite' },
      { text: 'Notes', link: '/sync/demos/notes' },
      { text: 'Pixel art', link: '/sync/demos/pixel-art' },
    ],
  },
  {
    text: 'Technical examples',
    collapsed: false,
    items: [
      { text: 'Bash', link: '/sync/demos/bash' },
      { text: 'Encryption', link: '/sync/demos/encryption' },
      { text: 'Gatekeeper auth', link: '/sync/demos/gatekeeper-auth' },
      { text: 'Next.js', link: '/sync/demos/nextjs' },
      { text: 'Phoenix LiveView', link: '/sync/demos/phoenix-liveview' },
      { text: 'Proxy auth', link: '/sync/demos/proxy-auth' },
      { text: 'React', link: '/sync/demos/react' },
      { text: 'Redis', link: '/sync/demos/redis' },
      { text: 'Remix', link: '/sync/demos/remix' },
      { text: 'Tanstack', link: '/sync/demos/tanstack' },
      { text: 'Todo app', link: '/sync/demos/todo-app' },
      { text: 'Write patterns', link: '/sync/demos/write-patterns' },
      { text: 'Yjs', link: '/sync/demos/yjs' },
    ],
  },
]

// Shared sidebar for the Streams docs section.
const streamsDocsSidebar = [
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
    ],
  },
  // "Open Protocol" — single outbound link to durablestreams.com.
  // Omitting `collapsed` (and only providing one item) keeps this
  // group rendered open with no collapse chevron, since the
  // protocol material lives on a separate site and there's nothing
  // to expand into.
  {
    text: 'Open Protocol',
    items: [
      {
        text: 'durablestreams.com',
        link: 'https://durablestreams.com',
      },
    ],
  },
]

// Compact sidebar for the Streams demos section. The product title,
// Overview / Quickstart / Demos links are rendered above this by
// `DocsSidebarHero.vue`.
const streamsDemosSidebar = [
  {
    text: 'Demo apps',
    collapsed: false,
    items: [
      {
        text: 'Durable Doom',
        link: '/streams/demos/durable-doom',
      },
      {
        text: 'Collaborative AI Editor',
        link: '/streams/demos/collaborative-ai-editor',
      },
      { text: 'Territory Wars', link: '/streams/demos/territory-wars' },
    ],
  },
  {
    text: 'Technical examples',
    collapsed: false,
    items: [
      {
        text: 'Yjs demo',
        link: 'https://github.com/durable-streams/durable-streams/tree/main/examples/yjs-demo',
      },
      {
        text: 'StreamDB',
        link: 'https://github.com/durable-streams/durable-streams/tree/main/examples/stream-db',
      },
      {
        text: 'Chat AI SDK',
        link: 'https://github.com/durable-streams/durable-streams/tree/main/examples/chat-aisdk',
      },
      {
        text: 'Chat TanStack',
        link: 'https://github.com/durable-streams/durable-streams/tree/main/examples/chat-tanstack',
      },
    ],
  },
]

const FALLBACK_SITE_ORIGIN = `https://electric-sql.com`
const LOCAL_DEV_SITE_ORIGIN = `http://localhost:5173`

function resolveSiteOrigin(): string {
  return process.env.CONTEXT === `production`
    ? process.env.URL || FALLBACK_SITE_ORIGIN
    : process.env.DEPLOY_PRIME_URL ||
        (process.env.NODE_ENV === `development`
          ? LOCAL_DEV_SITE_ORIGIN
          : FALLBACK_SITE_ORIGIN)
}

// https://vitepress.dev/reference/site-config
export default defineConfig({
  vite: {
    resolve: {
      // A single ESM copy of PGlite: otherwise the sync landing bundle can
      // end up with duplicate graph edges (e.g. REPL + search/local chunks)
      // and fetch initdb + wasm + .data more than once per page load.
      dedupe: ['@electric-sql/pglite', '@electric-sql/pglite-repl'],
    },
    define: {
      // Expose Netlify environment variables to the client
      'import.meta.env.DEPLOY_PRIME_URL': JSON.stringify(
        process.env.DEPLOY_PRIME_URL || ''
      ),
      __MARKDOWN_EXPORT__: JSON.stringify(MARKDOWN_EXPORT),
    },
    // PGlite ships a precompiled WASM build + a binary FS data bundle
    // (`pglite.data`). Vite's dependency optimizer rewrites these as
    // text and corrupts them, which surfaces at runtime as
    // `Invalid FS bundle size: <small> !== <real>`. Excluding the
    // package from optimizeDeps makes Vite serve the original ESM
    // build untouched. See pglite docs > Bundler Support.
    optimizeDeps: {
      exclude: ['@electric-sql/pglite'],
    },
    plugins: [
      markdownAssetDevServer(),
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
          // Internal recording stage — not linked from any nav, not
          // indexed in llms.txt. See `website/brand-toys.md`.
          'brand-toys*',
          // OG image cards — these only exist as a screenshot surface
          // for `pnpm build-og-images` and are excluded from the
          // sitemap and given `noindex` in `transformHead`. Keeping
          // them out of llms.txt for the same reason: they're not
          // user-facing pages.
          'og/**',
        ],
      }),
    ],
  },
  lang: 'en',
  title: 'Electric',
  description:
    "Electric provides the data primitives and infra to build collaborative, multi-agent systems. Including Postgres Sync, Durable Streams, TanStack DB and PGlite.",
  appearance: 'force-dark',
  base: '/',
  cleanUrls: true,
  outDir: MARKDOWN_EXPORT ? './.vitepress/dist-markdown' : './.vitepress/dist',
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
        'data-domain': 'electric-sql.com,electric.ax',
        src: 'https://plausible.io/js/script.js',
      },
    ],
  ],
  ignoreDeadLinks: [
    /localhost/,
  ],
  markdown: {
    theme: 'github-dark',
    // Shiki 3 and VitePress Shiki 1 `LanguageInput` types are incompatible; assert to VitePress `markdown.languages`.
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
      caddyfileLanguage,
    ] as NonNullable<MarkdownOptions['languages']>,
    config(md) {
      md.use(tabsMarkdownPlugin)
    },
  },
  rewrites(id) {
    const sourceId = toVitePressSourceId(id)

    if (sourceId.startsWith('blog/posts')) {
      // 'blog/posts/:year-:month-:day-:slug.md': 'blog/:year/:month/:day/:slug.md'
      return sourceId.replace(
        /^blog\/posts\/(2[0-9][0-9][0-9])-([0-9][0-9])-([0-9][0-9])-(.*)/,
        'blog/$1/$2/$3/$4'
      )
    }
    return sourceId
  },
  sitemap: {
    hostname: resolveSiteOrigin(),
    // Drop `/og/*` routes from the sitemap. They only exist as a
    // screenshot surface for `pnpm build-og-images`; the rendered HTML
    // pages still ship in the build (so the screenshot pipeline can
    // load them via the dev server) but they aren't user-facing.
    transformItems: (items) =>
      items.filter((item) => !item.url.startsWith('og/')),
  },
  // https://vitepress.dev/reference/default-theme-config
  themeConfig: {
    editLink: {
      pattern:
        'https://github.com/electric-sql/electric/edit/main/website/:path',
    },
    logo: { light: '/img/brand/logo.inverse.svg', dark: '/img/brand/logo.svg', alt: 'Electric' },
    nav: [],
    search: {
      provider: 'local',
    },
    sidebar: {
      '/cloud/': [
        // Title-button + primary links (Usage, CLI, Pricing, Dashboard)
        // at the top of the sidebar are rendered by `DocsSidebarHero.vue`
        // (mounted via the `sidebar-nav-before` slot in Layout.vue), so
        // the sidebar starts directly with the products Electric Cloud
        // hosts.
        {
          text: 'Hosted products',
          collapsed: false,
          items: [
            { text: 'Electric Streams', link: '/streams' },
            { text: 'Electric Sync', link: '/sync' },
          ],
        },
      ],
      // Primitive pages live at /sync/{primitive} but conceptually
      // belong to the sync docs — they use the docs sidebar so users
      // can navigate sideways into Guides / API / Integrations.
      //
      // IMPORTANT: VitePress sorts sidebar keys by path-segment count
      // and the sort is stable, so keys with the SAME depth fall back
      // to insertion order. `/sync/postgres-sync` and `/sync/` both
      // have the same segment count, so the more specific primitive
      // keys MUST come before `/sync/` here, otherwise `/sync/` would
      // match every `/sync/*` path first.
      '/sync/postgres-sync': syncDocsSidebar,
      '/sync/tanstack-db': syncDocsSidebar,
      '/sync/pglite': syncDocsSidebar,
      // Demo pages live at marketing URLs (/sync/demos/*) and get a
      // compact section sidebar under the Sync product hero. Same
      // insertion-order rule as the primitives above: this MUST come
      // before `/sync/` so it wins the prefix match.
      '/sync/demos': syncDemosSidebar,
      // Marketing-style /sync/* fallback. The /sync landing page
      // itself sets `sidebar: false`, so this only catches anything
      // under /sync/* that doesn't have a more specific sidebar key
      // above (currently nothing — but kept as a safety net).
      '/sync/': [
        {
          text: 'Electric Sync',
          items: [{ text: 'Overview', link: '/sync' }],
        },
        {
          text: 'Sync primitives',
          items: [
            { text: 'Postgres Sync', link: '/sync/postgres-sync' },
            { text: 'TanStack DB', link: '/sync/tanstack-db' },
            { text: 'PGlite', link: '/sync/pglite' },
          ],
        },
      ],
      // Demo-section sidebars keep the product hero links at the top,
      // then focus the sidebar on demos and examples.
      '/agents/demos': agentsDemosSidebar,
      '/streams/demos': streamsDemosSidebar,
      '/docs/sync': syncDocsSidebar,
      // Agents examples are surfaced from the demos section, so keep
      // their pages on the same compact demos/examples sidebar.
      '/docs/agents/examples': agentsDemosSidebar,
      '/docs/agents': agentsDocsSidebar,
      '/docs/streams': streamsDocsSidebar,
      '/about': resourcesSidebar,
      '/llms': resourcesSidebar,
    },
    siteTitle: false,
    socialLinks: [],
  },
  transformHead: ({ pageData, siteData }): HeadConfig[] => {
    const fm = pageData.frontmatter
    const head: HeadConfig[] = []

    // OG image cards (`/og/*`) are screenshot surfaces only — keep
    // them out of every search engine and skip the social-card meta
    // since they're never shared as URLs themselves.
    if (pageData.relativePath.startsWith('og/')) {
      head.push(['meta', { name: 'robots', content: 'noindex,nofollow' }])
      return head
    }

    const pageTitle = fm.title || siteData.title
    const titleTemplate = fm.titleTemplate || ':title | Electric'
    const title = titleTemplate.replace(':title', pageTitle)
    const description = fm.description || siteData.description

    // Default fallback social card. Generated by `pnpm build-og-images`
    // from `/og/default` and committed to `public/img/meta/`.
    const DEFAULT_IMAGE = '/img/meta/electric.jpg'

    const siteOrigin = resolveSiteOrigin()

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
  async buildEnd(siteConfig) {
    if (MARKDOWN_EXPORT) {
      await exportMarkedPagesToMarkdown(siteConfig.outDir)
    }
  },
})
