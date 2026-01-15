// Search engine crawlers that need HTML for proper indexing.
// These bots index content for search results and need full HTML
// with proper meta tags, structured data, and rendered content.
//
// Single pre-compiled regex for efficient matching. Case-insensitive.
// Patterns include:
//   - Google (Googlebot, AdsBot-Google, Mediapartners-Google)
//   - Bing (bingbot, adidxbot, msnbot)
//   - Yahoo (Slurp)
//   - DuckDuckGo (DuckDuckBot)
//   - Yandex (YandexBot)
//   - Baidu (Baiduspider)
//   - Sogou
//   - AI search bots (Claude-SearchBot, OAI-SearchBot) - not training bots
const SEARCH_ENGINE_PATTERNS = [
  `googlebot`,
  `adsbot-google`,
  `mediapartners-google`,
  `feedfetcher-google`,
  `google-inspectiontool`,
  `storebot-google`,
  `bingbot`,
  `adidxbot`,
  `msnbot`,
  `slurp`, // Yahoo
  `duckduckbot`,
  `yandexbot`,
  `baiduspider`,
  `sogou`,
  `petalbot`, // Huawei/Aspiegel
  `seznambot`, // Czech search engine
  `exabot`,
  // AI search bots (these index for search/citations, not training)
  `claude-searchbot`,
  `oai-searchbot`,
]

export const SEARCH_ENGINE_REGEX = new RegExp(
  SEARCH_ENGINE_PATTERNS.join(`|`),
  `i`
)

/**
 * Check if the user-agent indicates a search engine crawler that needs HTML
 * for proper indexing in search results.
 */
export function isSearchEngineBot(userAgent: string): boolean {
  return SEARCH_ENGINE_REGEX.test(userAgent)
}

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
const SOCIAL_BOT_PATTERNS = [
  `twitterbot`,
  `facebookexternalhit`,
  `facebot`,
  `meta-external`,
  `linkedinbot`,
  `slackbot`,
  `slack-imgproxy`,
  `discordbot`,
  `telegrambot`,
  `whatsapp`,
  `pinterestbot`,
  `pinterest/`,
  `snapchat`,
  `redditbot`,
  `bluesky`,
  `mastodon`,
  `microsoft-teams`,
  `msteams`,
  `vkshare`,
  `line/`,
  `linebot`,
  `viber`,
  `wechat`,
  `micromessenger`,
  `kakao`,
  `embedly`,
  `iframely`,
  `unfurl`,
]

export const SOCIAL_BOT_REGEX = new RegExp(SOCIAL_BOT_PATTERNS.join(`|`), `i`)

/**
 * Check if the user-agent indicates a social media bot that needs HTML
 * with meta tags for generating link preview cards.
 */
export function isSocialMediaBot(userAgent: string): boolean {
  return SOCIAL_BOT_REGEX.test(userAgent)
}
