import { describe, it, expect } from 'vitest'
import {
  isSearchEngineBot,
  isSocialMediaBot,
} from '../../src/lib/social-bot-detection'

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

describe(`isSearchEngineBot`, () => {
  describe(`search engine bots - should return true (serve HTML)`, () => {
    const searchBots = [
      {
        ua: `Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)`,
        name: `Googlebot`,
      },
      {
        ua: `Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/W.X.Y.Z Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)`,
        name: `Googlebot Mobile`,
      },
      {
        ua: `AdsBot-Google (+http://www.google.com/adsbot.html)`,
        name: `AdsBot-Google`,
      },
      {
        ua: `Mediapartners-Google`,
        name: `Mediapartners-Google (AdSense)`,
      },
      {
        ua: `FeedFetcher-Google; (+http://www.google.com/feedfetcher.html)`,
        name: `FeedFetcher-Google`,
      },
      {
        ua: `Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)`,
        name: `Google-InspectionTool`,
      },
      {
        ua: `Mozilla/5.0 (compatible; Storebot-Google/1.0; +http://www.google.com/storebot.html)`,
        name: `Storebot-Google`,
      },
      {
        ua: `Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)`,
        name: `Bingbot`,
      },
      {
        ua: `Mozilla/5.0 (compatible; adidxbot/2.0; +http://www.bing.com/bingbot.htm)`,
        name: `adidxbot (Bing Ads)`,
      },
      {
        ua: `msnbot/2.0b (+http://search.msn.com/msnbot.htm)`,
        name: `msnbot`,
      },
      {
        ua: `Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)`,
        name: `Yahoo Slurp`,
      },
      {
        ua: `DuckDuckBot/1.0; (+http://duckduckgo.com/duckduckbot.html)`,
        name: `DuckDuckBot`,
      },
      {
        ua: `Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)`,
        name: `YandexBot`,
      },
      {
        ua: `Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)`,
        name: `Baiduspider`,
      },
      {
        ua: `Sogou web spider/4.0(+http://www.sogou.com/docs/help/webmasters.htm#07)`,
        name: `Sogou`,
      },
      {
        ua: `Mozilla/5.0 (compatible; PetalBot;+https://webmaster.petalsearch.com/site/petalbot)`,
        name: `PetalBot`,
      },
      {
        ua: `Mozilla/5.0 (compatible; SeznamBot/3.2; +http://napoveda.seznam.cz/en/seznambot-intro/)`,
        name: `SeznamBot`,
      },
      {
        ua: `Mozilla/5.0 (compatible; Exabot/3.0; +http://www.exabot.com/go/robot)`,
        name: `Exabot`,
      },
      // AI search bots (not training bots)
      {
        ua: `Claude-SearchBot/1.0`,
        name: `Claude-SearchBot`,
      },
      {
        ua: `OAI-SearchBot/1.0`,
        name: `OAI-SearchBot`,
      },
    ]

    it.each(searchBots)(`$name`, ({ ua }) => {
      expect(isSearchEngineBot(ua)).toBe(true)
    })
  })

  describe(`AI training bots - should return false (serve Markdown)`, () => {
    const trainingBots = [
      {
        ua: `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)`,
        name: `ClaudeBot (training)`,
      },
      {
        ua: `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.0; +https://openai.com/gptbot)`,
        name: `GPTBot (training)`,
      },
      {
        ua: `Mozilla/5.0 (compatible; Google-Extended; +https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers)`,
        name: `Google-Extended (AI training)`,
      },
      {
        ua: `ChatGPT-User/1.0`,
        name: `ChatGPT-User (live browsing)`,
      },
      {
        ua: `anthropic-ai`,
        name: `anthropic-ai`,
      },
      {
        ua: `CCBot/2.0`,
        name: `CCBot (Common Crawl)`,
      },
      {
        ua: `cohere-ai`,
        name: `cohere-ai`,
      },
    ]

    it.each(trainingBots)(`$name`, ({ ua }) => {
      expect(isSearchEngineBot(ua)).toBe(false)
    })
  })

  describe(`browsers and CLI tools - should return false`, () => {
    const others = [
      {
        ua: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36`,
        name: `Chrome`,
      },
      { ua: `curl/7.64.1`, name: `curl` },
      { ua: `Wget/1.21`, name: `wget` },
    ]

    it.each(others)(`$name`, ({ ua }) => {
      expect(isSearchEngineBot(ua)).toBe(false)
    })
  })

  describe(`edge cases`, () => {
    it(`empty user agent`, () => {
      expect(isSearchEngineBot(``)).toBe(false)
    })

    it(`random string`, () => {
      expect(isSearchEngineBot(`some random string`)).toBe(false)
    })
  })
})
