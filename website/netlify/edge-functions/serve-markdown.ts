import type { Context } from 'https://edge.netlify.com'

// Social media and messaging platform bots that need HTML with meta tags for
// link previews. These fetchers retrieve Open Graph / Twitter Card metadata
// to generate rich preview cards when links are shared.
//
// Single pre-compiled regex for efficient matching. Case-insensitive.
// Patterns include:
//   - Twitter/X (Twitterbot)
//   - Facebook/Meta (facebookexternalhit, Facebot, Meta-ExternalFetcher, Meta-ExternalAgent)
//   - LinkedIn (LinkedInBot)
//   - Slack (Slackbot, Slack-ImgProxy)
//   - Discord (Discordbot)
//   - Telegram (TelegramBot)
//   - WhatsApp
//   - Pinterest (Pinterestbot, Pinterest/)
//   - Snapchat (Snap URL Preview Service)
//   - Reddit (redditbot)
//   - Bluesky
//   - Mastodon (and Fediverse instances)
//   - Microsoft Teams (Microsoft-Teams, MSTeams)
//   - VKontakte (vkShare)
//   - Line (Line/, LineBot)
//   - Viber
//   - WeChat (MicroMessenger)
//   - Kakao
//   - Embedly, Iframely (link preview services)
const SOCIAL_BOT_REGEX =
  /twitterbot|facebookexternalhit|facebot|meta-external|linkedinbot|slackbot|slack-imgproxy|discordbot|telegrambot|whatsapp|pinterestbot|pinterest\/|snapchat|redditbot|bluesky|mastodon|microsoft-teams|msteams|vkshare|line\/|linebot|viber|wechat|micromessenger|kakao|embedly|iframely|unfurl/i

/**
 * Check if the user-agent indicates a social media bot that needs HTML
 * with meta tags for generating link preview cards.
 */
function isSocialMediaBot(userAgent: string): boolean {
  return SOCIAL_BOT_REGEX.test(userAgent)
}

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
  const userAgent = request.headers.get(`user-agent`) || ``
  let targetPath = url.pathname

  // Social media bots need HTML with Open Graph / Twitter Card meta tags
  // to generate rich link preview cards. Always serve HTML to these bots.
  if (isSocialMediaBot(userAgent)) {
    return context.next()
  }

  // Skip hidden paths (like /.vitepress/) - these are internal files
  if (url.pathname.startsWith(`/.`)) {
    return context.next()
  }

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
