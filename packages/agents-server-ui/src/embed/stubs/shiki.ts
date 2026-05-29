/**
 * Mobile-embed stub for `shiki/bundle/web`.
 *
 * Shiki ships ~3.8 MB of grammars and themes. The mobile embed
 * accepts unhighlighted (plain) code blocks instead so the bundle
 * stays small. Code still renders in monospace via `markdown.css`;
 * only the per-token colours are missing.
 *
 * The real `createHighlighter` is async, so the stub matches that
 * shape and returns a no-op `codeToTokens` that produces a single
 * uncoloured line. `MarkdownCodeBlock` falls back to plain
 * `<pre><code>…</code></pre>` rendering when no tokens come back.
 */

type Token = {
  content: string
  color?: string
  htmlStyle?: Record<string, string>
}

type CodeToTokensResult = {
  tokens: Array<Array<Token>>
  bg?: string
  fg?: string
}

type StubHighlighter = {
  codeToTokens: (code: string) => CodeToTokensResult
  dispose: () => void
}

export async function createHighlighter(): Promise<StubHighlighter> {
  return {
    codeToTokens: (code: string) => ({
      tokens: code
        .split(`\n`)
        .map((line) => (line.length === 0 ? [] : [{ content: line }])),
      bg: `transparent`,
      fg: `inherit`,
    }),
    dispose: () => {},
  }
}

// `codeHighlighter.ts` does `import type { Highlighter }` from this
// path. The runtime alias points the type-only import here too, so
// re-export a structurally compatible alias.
export type Highlighter = StubHighlighter
