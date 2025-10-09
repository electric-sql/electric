import type { Context } from 'https://edge.netlify.com'

// Path prefixes that should serve markdown to agents
const PATH_PREFIXES = [
  `/about/`,
  `/blog/`,
  `/demos/`,
  `/docs/`,
  `/product/`,
  `/use-cases/`,
]

// Specific full paths (without extensions)
const FULL_PATHS = [`/`, `/demos`]

// Blacklisted blog post patterns (old posts to ignore)
const BLACKLISTED_BLOG_PATTERNS = [
  /^\/blog\/2022\//,
  /^\/blog\/2023\//,
  /^\/blog\/2024\/01\//,
  /^\/blog\/2024\/02\//,
  /^\/blog\/2024\/03\//,
  /^\/blog\/2024\/04\//,
  /^\/blog\/2024\/05\//,
  /^\/blog\/2024\/06\//,
]

function isBlogPostBlacklisted(pathname: string): boolean {
  return BLACKLISTED_BLOG_PATTERNS.some((pattern) => pattern.test(pathname))
}

function transformBlogPostPath(pathname: string): string | null {
  // Match blog post pattern: /blog/YYYY/MM/DD/slug or /blog/YYYY/MM/DD/slug.md
  const blogPostMatch = pathname.match(
    /^\/blog\/(\d{4})\/(\d{2})\/(\d{2})\/([^\/]+?)(\.md)?$/
  )

  if (!blogPostMatch) {
    return null
  }

  const [, year, month, day, slug] = blogPostMatch

  // Remove .html or .md extension from slug if present
  const cleanSlug = slug.replace(/\.(html|md)$/, ``)

  // Transform to markdown path: /blog/posts/YYYY-MM-DD-slug.md
  return `/blog/posts/${year}-${month}-${day}-${cleanSlug}.md`
}

export default async (request: Request, context: Context) => {
  const url = new URL(request.url)
  const acceptHeader = request.headers.get(`accept`) || ``
  let targetPath = url.pathname

  // Check if this is a blog post
  const isBlogPost =
    url.pathname.startsWith(`/blog/`) &&
    url.pathname.match(/\/\d{4}\/\d{2}\/\d{2}\//)

  if (isBlogPost) {
    if (isBlogPostBlacklisted(url.pathname)) {
      return context.next()
    }

    const mdPath = transformBlogPostPath(url.pathname)
    if (mdPath) {
      // For blog posts, serve markdown if:
      // 1. Explicitly requesting .md (always serve markdown)
      // 2. Not requesting HTML (coding agents)
      const isExplicitMdRequest = url.pathname.endsWith(`.md`)
      const shouldServeMd =
        isExplicitMdRequest || !acceptHeader.includes(`text/html`)

      if (shouldServeMd) {
        const mdUrl = new URL(mdPath, url.origin)
        const mdResponse = await fetch(mdUrl)

        if (mdResponse.ok) {
          return new Response(mdResponse.body, {
            headers: { 'Content-Type': `text/markdown; charset=utf-8` },
          })
        }
      }
    }

    return context.next()
  }

  // Handle other whitelisted paths (docs, guide, etc.)
  const matchesPrefix = PATH_PREFIXES.some((prefix) =>
    url.pathname.startsWith(prefix)
  )

  const matchesFullPath = FULL_PATHS.some(
    (path) => url.pathname === path || url.pathname.startsWith(path + `.`)
  )

  const isWhitelisted = matchesPrefix || matchesFullPath

  if (isWhitelisted && !acceptHeader.includes(`text/html`)) {
    if (url.pathname === `/`) {
      targetPath = `/llms.txt`
    } else if (!url.pathname.endsWith(`.md`)) {
      targetPath = url.pathname.endsWith(`/`)
        ? `${url.pathname}index.md`
        : `${url.pathname}.md`
    }

    const mdUrl = new URL(targetPath, url.origin)
    const mdResponse = await fetch(mdUrl)

    if (mdResponse.ok) {
      return new Response(mdResponse.body, {
        headers: { 'Content-Type': `text/markdown; charset=utf-8` },
      })
    }
  }

  return context.next()
}
