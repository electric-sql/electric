#!/usr/bin/env node
/**
 * Unit tests for the social media bot detection logic.
 * Run with: node netlify/edge-functions/__tests__/serve-markdown.test.js
 */

// Copy of the regex from serve-markdown.ts
const SOCIAL_BOT_REGEX =
  /twitterbot|facebookexternalhit|facebot|meta-external|linkedinbot|slackbot|slack-imgproxy|discordbot|telegrambot|whatsapp|pinterestbot|pinterest\/|snapchat|redditbot|bluesky|mastodon|microsoft-teams|msteams|vkshare|line\/|linebot|viber|wechat|micromessenger|kakao|embedly|iframely|unfurl/i

function isSocialMediaBot(userAgent) {
  return SOCIAL_BOT_REGEX.test(userAgent)
}

// Test cases
const testCases = [
  // Social media bots - should return TRUE (get HTML)
  { ua: `Twitterbot/1.0`, expected: true, name: `Twitter` },
  {
    ua: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Twitterbot/1.0`,
    expected: true,
    name: `Twitter with Mozilla prefix`,
  },
  {
    ua: `facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)`,
    expected: true,
    name: `Facebook`,
  },
  {
    ua: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0`,
    expected: true,
    name: `iMessage (impersonates FB+Twitter)`,
  },
  {
    ua: `LinkedInBot/1.0 (compatible; Mozilla/5.0; Jakarta Commons-HttpClient/4.3 +http://www.linkedin.com)`,
    expected: true,
    name: `LinkedIn`,
  },
  {
    ua: `Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)`,
    expected: true,
    name: `Slack`,
  },
  {
    ua: `Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)`,
    expected: true,
    name: `Discord`,
  },
  { ua: `TelegramBot (like TwitterBot)`, expected: true, name: `Telegram` },
  { ua: `WhatsApp/2.23.20.0`, expected: true, name: `WhatsApp` },
  {
    ua: `Pinterest/0.2 (+http://www.pinterest.com/bot.html)`,
    expected: true,
    name: `Pinterest`,
  },
  {
    ua: `Snap URL Preview Service; bot; snapchat; https://developers.snap.com/robots`,
    expected: true,
    name: `Snapchat`,
  },
  {
    ua: `Mozilla/5.0 (compatible; redditbot/1.0; +http://www.reddit.com/feedback)`,
    expected: true,
    name: `Reddit`,
  },
  { ua: `Bluesky Link Preview Service`, expected: true, name: `Bluesky` },
  {
    ua: `http.rb/5.1.1 (Mastodon/4.2.0; +https://mastodon.social/)`,
    expected: true,
    name: `Mastodon`,
  },
  {
    ua: `Mozilla/5.0 (compatible; vkShare; +http://vk.com/dev/Share)`,
    expected: true,
    name: `VKontakte`,
  },
  { ua: `Line/10.21.0`, expected: true, name: `Line` },
  { ua: `Viber/16.0.0.0`, expected: true, name: `Viber` },
  {
    ua: `Mozilla/5.0 (Linux; U; Android; MicroMessenger/8.0)`,
    expected: true,
    name: `WeChat`,
  },

  // Coding agents / CLI tools - should return FALSE (get Markdown)
  { ua: `curl/7.64.1`, expected: false, name: `curl` },
  { ua: `Wget/1.21`, expected: false, name: `wget` },
  { ua: `python-requests/2.28.0`, expected: false, name: `Python requests` },
  {
    ua: `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)`,
    expected: false,
    name: `ClaudeBot`,
  },
  {
    ua: `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.0; +https://openai.com/gptbot)`,
    expected: false,
    name: `GPTBot`,
  },
  { ua: `httpie/3.2.1`, expected: false, name: `HTTPie` },
  { ua: `axios/1.4.0`, expected: false, name: `Axios` },
  { ua: `node-fetch/3.0.0`, expected: false, name: `Node fetch` },

  // Browsers - should return FALSE (get HTML via Accept header, not bot detection)
  {
    ua: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36`,
    expected: false,
    name: `Chrome browser`,
  },
  {
    ua: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15`,
    expected: false,
    name: `Safari browser`,
  },
  {
    ua: `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0`,
    expected: false,
    name: `Firefox browser`,
  },

  // Edge cases
  { ua: ``, expected: false, name: `Empty user agent` },
  { ua: `some random string`, expected: false, name: `Random string` },
]

// Run tests
console.log(`Testing social media bot detection...\n`)
let passed = 0
let failed = 0

for (const test of testCases) {
  const result = isSocialMediaBot(test.ua)
  const status = result === test.expected ? `✓` : `✗`

  if (result === test.expected) {
    passed++
    console.log(`${status} ${test.name}: ${result ? `HTML` : `Markdown`}`)
  } else {
    failed++
    console.log(
      `${status} ${test.name}: got ${result ? `HTML` : `Markdown`}, expected ${test.expected ? `HTML` : `Markdown`}`
    )
    console.log(`  User-Agent: ${test.ua}`)
  }
}

console.log(`\n${`=`.repeat(50)}`)
console.log(`Results: ${passed} passed, ${failed} failed`)

if (failed > 0) {
  process.exit(1)
}
