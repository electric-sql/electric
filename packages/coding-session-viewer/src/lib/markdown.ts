import MarkdownIt from 'markdown-it'
import { createHighlighter, type Highlighter } from 'shiki/bundle/web'

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  highlight: () => ``,
})

// Limit to commonly-used languages to keep bundle size sane.
// Adding a language not in this list = falls back to plain text.
const SUPPORTED_LANGS = [
  `bash`,
  `shell`,
  `sh`,
  `console`,
  `diff`,
  `go`,
  `html`,
  `css`,
  `javascript`,
  `js`,
  `json`,
  `jsonc`,
  `markdown`,
  `md`,
  `python`,
  `py`,
  `rust`,
  `sql`,
  `typescript`,
  `ts`,
  `tsx`,
  `jsx`,
  `yaml`,
  `yml`,
  `xml`,
] as const

let highlighterPromise: Promise<Highlighter> | null = null
function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [`github-dark`],
      langs: [...SUPPORTED_LANGS],
    })
  }
  return highlighterPromise
}

export function renderMarkdown(text: string): string {
  return md.render(text)
}

export async function highlightCodeBlocks(element: HTMLElement): Promise<void> {
  const blocks = element.querySelectorAll(`pre > code`)
  if (blocks.length === 0) return

  const highlighter = await getHighlighter()
  const supportedLangs = highlighter.getLoadedLanguages()

  for (const codeEl of Array.from(blocks)) {
    const langClass = Array.from(codeEl.classList).find((c) =>
      c.startsWith(`language-`)
    )
    const requestedLang = langClass
      ? langClass.replace(`language-`, ``)
      : `text`
    const lang = (supportedLangs as Array<string>).includes(requestedLang)
      ? requestedLang
      : `text`
    const code = codeEl.textContent ?? ``
    try {
      const html = highlighter.codeToHtml(code, {
        lang,
        theme: `github-dark`,
      })
      const parent = codeEl.parentElement
      if (parent && parent.tagName === `PRE`) {
        const wrapper = document.createElement(`div`)
        wrapper.innerHTML = html
        parent.replaceWith(wrapper.firstElementChild!)
      }
    } catch {
      // Unknown language or other error — leave as plain
    }
  }
}
