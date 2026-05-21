/**
 * Mobile-embed stub for `katex`.
 *
 * KaTeX ships ~600 KB of glyph metrics. The mobile embed renders
 * math source as escaped monospaced text instead — readable, and
 * large enough that the user can spot expressions without paying for
 * the renderer.
 *
 * Aliased in `vite.config.ts` mobile-embed mode so `katex` imports
 * resolve here. `MarkdownCodeBlock`'s `katex.renderToString(source)`
 * call is the only consumer.
 */

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, `&amp;`)
    .replace(/</g, `&lt;`)
    .replace(/>/g, `&gt;`)
    .replace(/"/g, `&quot;`)
    .replace(/'/g, `&#39;`)
}

function renderToString(source: string): string {
  return `<code class="katex-mobile-stub">${escapeHtml(source)}</code>`
}

function render(source: string, target: HTMLElement): void {
  target.innerHTML = renderToString(source)
}

const katex = { renderToString, render }
export default katex
export { renderToString, render }
