import { createMathPlugin } from '@streamdown/math'
import { createCodePlugin } from './codeHighlighter'
import { MarkdownAnchor } from '../components/MarkdownAnchor'
import { MarkdownCodeBlock } from '../components/MarkdownCodeBlock'
import { MarkdownImage } from '../components/MarkdownImage'
import { MarkdownTable } from '../components/MarkdownTable'

// Shared Streamdown configuration used by every consumer that
// renders agent / assistant markdown (currently AgentResponse).
// Centralising the plugin singleton + component overrides means
// render paths stay in lockstep — same Shiki highlighter, same
// custom block renderers, same toolbar behaviour.

const codePluginSingleton = createCodePlugin()

// Enable single-dollar inline math (`$E=mc^2$`) on top of the
// double-dollar display syntax (`$$…$$`). Fenced ```` ```math ```` blocks
// are handled separately by `MarkdownCodeBlock.tsx`, which calls
// KaTeX directly. KaTeX glyph CSS is imported once at the top of
// `markdown.css`.
const mathPluginSingleton = createMathPlugin({ singleDollarTextMath: true })

/**
 * Streamdown plugins:
 *   - `code` → Shiki highlighter consumed by `MarkdownCodeBlock.tsx`
 *     for its own highlight pass via `highlightCodeTokens`. Still
 *     passed through here so anything that fell through to the
 *     built-in code pipeline shares the same Shiki instance.
 *   - `math` → `@streamdown/math` (remark-math + rehype-katex). Adds
 *     `$inline$` / `$$display$$` math support; the `singleDollarTextMath`
 *     option above turns on single-dollar inline syntax.
 */
export const streamdownPlugins = {
  code: codePluginSingleton,
  math: mathPluginSingleton,
} as const

/**
 * Disable Streamdown's built-in toolbars for blocks we replace
 * ourselves. `MarkdownCodeBlock` and `MarkdownTable` render their
 * own Base UI–powered toolbars; turning Streamdown's off here avoids
 * a double-toolbar render and removes the inert Tailwind chrome
 * from the DOM entirely for those two block types.
 */
export const streamdownControls = { code: false, table: false } as const

/**
 * Component overrides that swap Streamdown's Tailwind-laden / extra
 * chrome renderers for our own clean-DOM versions:
 *
 *   - `code`  → `MarkdownCodeBlock` (full code-block rewrite, see
 *     the long header comment in that file).
 *   - `table` → `MarkdownTable` (full table-block rewrite + Base UI
 *     toolbar).
 *   - `img`   → `MarkdownImage` — Streamdown's default `img` slot
 *     IS the wrapper-overlay-download-button structure; replacing
 *     it strips the wrapper and the floating download button so
 *     markdown images render as a bare styled `<img>`.
 *   - `a`     → `MarkdownAnchor` — same default link styling, plus
 *     a click handler that intercepts in-page `#fragment` links
 *     (e.g. footnote backrefs) and calls `scrollIntoView` directly,
 *     bypassing the hash router.
 */
export const streamdownComponents = {
  code: MarkdownCodeBlock,
  table: MarkdownTable,
  img: MarkdownImage,
  a: MarkdownAnchor,
} as const
