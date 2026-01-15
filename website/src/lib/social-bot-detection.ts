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
