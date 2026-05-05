import { createHighlighter } from 'shiki/bundle/web'
import type { Highlighter } from 'shiki/bundle/web'
import type { CodeHighlighterPlugin } from 'streamdown'

const LIGHT_THEME = `github-light`
const DARK_THEME = `github-dark`
const THEMES = [LIGHT_THEME, DARK_THEME] as const

export type HighlightTokensResult = {
  bg: string
  fg: string
  tokens: Array<
    Array<{
      content: string
      color?: string
      htmlStyle?: Record<string, string>
    }>
  >
}

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
let highlighterInstance: Highlighter | null = null

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [...THEMES],
      langs: COMMON_LANGS,
    }).then((h) => {
      highlighterInstance = h
      return h
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

function doHighlight(
  h: Highlighter,
  code: string,
  lang: string
): HighlightTokensResult {
  const result = h.codeToTokens(code, {
    lang: lang as any,
    themes: { light: LIGHT_THEME, dark: DARK_THEME },
    // Emit BOTH themes as CSS variables (`--shiki-light` and
    // `--shiki-dark`) instead of stamping the default theme's hex
    // directly on the `color` property. Without this, Shiki's
    // default (`defaultColor: 'light'`) means tokens come back with
    // `color: '#xxxLight'` and only `--shiki-dark` set as a
    // variable — which would leave our `var(--shiki-light, inherit)`
    // CSS rule in `markdown.css` falling back to `inherit` (i.e.
    // unhighlighted) in light mode.
    defaultColor: false,
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

/**
 * Synchronously highlight `code` if the Shiki highlighter is already
 * loaded; otherwise return `null` and invoke `onReady` once the
 * highlighter finishes its async warm-up.
 *
 * Standalone-by-design: callers (e.g. `MarkdownCodeBlock`) own the
 * loading-state UI and the cache, so this stays free of React
 * concerns. Returns `null` when:
 *
 *   - The highlighter hasn't finished loading (will warm + callback)
 *   - The language is unknown (no callback)
 *
 * On success, returns a {@link HighlightTokensResult} with separate
 * light + dark `htmlStyle` maps per token so the consumer can pick
 * the right colour at paint time.
 */
export function highlightCodeTokens(
  code: string,
  language: string,
  onReady?: (result: HighlightTokensResult) => void
): HighlightTokensResult | null {
  const lang = resolveLanguage(language)
  if (!lang) return null

  if (highlighterInstance) {
    return doHighlight(highlighterInstance, code, lang)
  }

  // Warm up (no-op if already in flight) then fire the callback so
  // the consumer can re-render with highlighted tokens.
  void getHighlighter()
    .then((h) => {
      const result = doHighlight(h, code, lang)
      onReady?.(result)
    })
    .catch((err) => {
      console.error(`Failed to initialize syntax highlighter:`, err)
    })

  return null
}
