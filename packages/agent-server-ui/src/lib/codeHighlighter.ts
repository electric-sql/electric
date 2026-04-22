import { createHighlighter } from 'shiki/bundle/web'
import type { Highlighter } from 'shiki/bundle/web'
import type { CodeHighlighterPlugin } from 'streamdown'

const LIGHT_THEME = `github-light`
const DARK_THEME = `github-dark`
const THEMES = [LIGHT_THEME, DARK_THEME] as const

const COMMON_LANGS: Array<string> = [
  `typescript`,
  `javascript`,
  `tsx`,
  `jsx`,
  `json`,
  `jsonc`,
  `html`,
  `css`,
  `scss`,
  `less`,
  `shellscript`,
  `markdown`,
  `mdx`,
  `python`,
  `java`,
  `c`,
  `cpp`,
  `yaml`,
  `sql`,
  `xml`,
  `graphql`,
  `r`,
  `julia`,
]

const LANG_ALIASES: Record<string, string> = {
  bash: `shellscript`,
  shell: `shellscript`,
  sh: `shellscript`,
  zsh: `shellscript`,
  js: `javascript`,
  ts: `typescript`,
  py: `python`,
  yml: `yaml`,
  md: `markdown`,
}

function resolveLanguage(lang: string): string | undefined {
  if (COMMON_LANGS.includes(lang)) return lang
  if (lang in LANG_ALIASES) return LANG_ALIASES[lang]
  return undefined
}

let highlighterPromise: Promise<Highlighter> | null = null

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [...THEMES],
      langs: COMMON_LANGS,
    })
  }
  return highlighterPromise
}

export function createCodePlugin(): CodeHighlighterPlugin {
  let hl: Highlighter | null = null
  getHighlighter()
    .then((h) => {
      hl = h
    })
    .catch((err) => {
      console.error(`Failed to initialize syntax highlighter:`, err)
    })

  return {
    name: `shiki` as const,
    type: `code-highlighter` as const,
    getSupportedLanguages: () => COMMON_LANGS as any,
    supportsLanguage: (lang: string) => !!resolveLanguage(lang),
    getThemes: () => THEMES as unknown as [any, any],
    highlight: (options, callback) => {
      const { code, language } = options
      const lang = resolveLanguage(language)

      if (!hl) {
        getHighlighter()
          .then((h) => {
            hl = h
            if (lang) {
              const result = doHighlight(h, code, lang)
              callback?.(result)
            }
          })
          .catch((err) => {
            console.error(`Failed to initialize syntax highlighter:`, err)
          })
        return null
      }

      if (!lang) return null
      return doHighlight(hl, code, lang)
    },
  }
}

function doHighlight(h: Highlighter, code: string, lang: string): any {
  const result = h.codeToTokens(code, {
    lang: lang as any,
    themes: { light: LIGHT_THEME, dark: DARK_THEME },
  })

  const bg = typeof result.bg === `string` ? result.bg.split(`;`)[0] : undefined
  const fg = typeof result.fg === `string` ? result.fg.split(`;`)[0] : undefined

  return {
    bg: bg || `transparent`,
    fg: fg || `inherit`,
    tokens: result.tokens.map((line) =>
      line.map((token) => ({
        content: token.content,
        color: token.color,
        htmlStyle: token.htmlStyle,
      }))
    ),
  }
}
