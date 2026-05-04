import { createCodePlugin } from './codeHighlighter'
import { MarkdownCodeBlock } from '../components/MarkdownCodeBlock'
import { MarkdownTable } from '../components/MarkdownTable'

// Shared Streamdown configuration used by every consumer that
// renders agent / assistant markdown (currently AgentResponse and
// CodingSessionTimeline). Centralising the plugin singleton +
// component overrides means the two render paths stay in lockstep
// — same Shiki highlighter, same custom block renderers, same
// toolbar behaviour.

const codePluginSingleton = createCodePlugin()

/**
 * Shiki highlighter exposed as a Streamdown `code` plugin.
 *
 * Consumed by `MarkdownCodeBlock.tsx` for its own (custom) highlight
 * pass via `highlightCodeTokens`; we still pass it through to
 * Streamdown so anything that fell through to the built-in code
 * pipeline (mermaid blocks, custom renderers, etc.) shares the same
 * Shiki instance.
 */
export const streamdownPlugins = { code: codePluginSingleton } as const

/**
 * Disable Streamdown's built-in toolbars for blocks we replace
 * ourselves. `MarkdownCodeBlock` and `MarkdownTable` render their
 * own Base UI–powered toolbars; turning Streamdown's off here avoids
 * a double-toolbar render and removes the inert Tailwind chrome
 * from the DOM entirely for those two block types.
 */
export const streamdownControls = { code: false, table: false } as const

/**
 * Component overrides that swap Streamdown's Tailwind-laden code
 * and table renderers for our own clean-DOM versions. Each
 * replacement emits stable `data-md-*` attributes that match
 * selectors in `markdown.css`; together with `streamdownControls`
 * above this means the rendered output for code and table blocks
 * carries no inert Tailwind utility class strings at all.
 */
export const streamdownComponents = {
  code: MarkdownCodeBlock,
  table: MarkdownTable,
} as const
