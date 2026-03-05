import { describe, it, expect } from 'vitest'
import { isSocialMediaBot } from '../../src/lib/social-bot-detection'

describe(`isSocialMediaBot`, () => {
  describe(`social media bots - should return true (serve HTML)`, () => {
    const socialBots = [
      { ua: `Twitterbot/1.0`, name: `Twitter` },
      {
        ua: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Twitterbot/1.0`,
        name: `Twitter with Mozilla prefix`,
      },
      {
        ua: `facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)`,
        name: `Facebook`,
      },
      {
        ua: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0`,
        name: `iMessage (impersonates FB+Twitter)`,
      },
      {
        ua: `LinkedInBot/1.0 (compatible; Mozilla/5.0; Jakarta Commons-HttpClient/4.3 +http://www.linkedin.com)`,
        name: `LinkedIn`,
      },
      {
        ua: `Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)`,
        name: `Slack`,
      },
      {
        ua: `Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)`,
        name: `Discord`,
      },
      { ua: `TelegramBot (like TwitterBot)`, name: `Telegram` },
      { ua: `WhatsApp/2.23.20.0`, name: `WhatsApp` },
      {
        ua: `Pinterest/0.2 (+http://www.pinterest.com/bot.html)`,
        name: `Pinterest`,
      },
      {
        ua: `Snap URL Preview Service; bot; snapchat; https://developers.snap.com/robots`,
        name: `Snapchat`,
      },
      {
        ua: `Mozilla/5.0 (compatible; redditbot/1.0; +http://www.reddit.com/feedback)`,
        name: `Reddit`,
      },
      { ua: `Bluesky Link Preview Service`, name: `Bluesky` },
      {
        ua: `http.rb/5.1.1 (Mastodon/4.2.0; +https://mastodon.social/)`,
        name: `Mastodon`,
      },
      {
        ua: `Mozilla/5.0 (compatible; vkShare; +http://vk.com/dev/Share)`,
        name: `VKontakte`,
      },
      { ua: `Line/10.21.0`, name: `Line` },
      { ua: `Viber/16.0.0.0`, name: `Viber` },
      {
        ua: `Mozilla/5.0 (Linux; U; Android; MicroMessenger/8.0)`,
        name: `WeChat`,
      },
    ]

    it.each(socialBots)(`$name`, ({ ua }) => {
      expect(isSocialMediaBot(ua)).toBe(true)
    })
  })

  describe(`coding agents / CLI tools - should return false (serve Markdown)`, () => {
    const cliTools = [
      { ua: `curl/7.64.1`, name: `curl` },
      { ua: `Wget/1.21`, name: `wget` },
      { ua: `python-requests/2.28.0`, name: `Python requests` },
      {
        ua: `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)`,
        name: `ClaudeBot`,
      },
      {
        ua: `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.0; +https://openai.com/gptbot)`,
        name: `GPTBot`,
      },
      { ua: `httpie/3.2.1`, name: `HTTPie` },
      { ua: `axios/1.4.0`, name: `Axios` },
      { ua: `node-fetch/3.0.0`, name: `Node fetch` },
    ]

    it.each(cliTools)(`$name`, ({ ua }) => {
      expect(isSocialMediaBot(ua)).toBe(false)
    })
  })

  describe(`browsers - should return false`, () => {
    const browsers = [
      {
        ua: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36`,
        name: `Chrome`,
      },
      {
        ua: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15`,
        name: `Safari`,
      },
      {
        ua: `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0`,
        name: `Firefox`,
      },
    ]

    it.each(browsers)(`$name`, ({ ua }) => {
      expect(isSocialMediaBot(ua)).toBe(false)
    })
  })

  describe(`edge cases`, () => {
    it(`empty user agent`, () => {
      expect(isSocialMediaBot(``)).toBe(false)
    })

    it(`random string`, () => {
      expect(isSocialMediaBot(`some random string`)).toBe(false)
    })
  })
})
