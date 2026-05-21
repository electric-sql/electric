/**
 * Mobile-embed stub for `@streamdown/math`.
 *
 * The real plugin pulls in `remark-math` + `rehype-katex` (the latter
 * loads the full KaTeX renderer). The mobile embed deliberately
 * skips math rendering so we return a pass-through plugin that does
 * nothing — `$inline$` and `$$display$$` math will just render as
 * literal text, matching how the KaTeX stub treats fenced ```` ```math ```` blocks.
 *
 * Aliased in `vite.config.ts` mobile-embed mode.
 */

type StubMathPlugin = {
  name: `katex`
  type: `math`
  remarkPlugin: () => void
  rehypePlugin: () => void
  getStyles?: () => string
}

export function createMathPlugin(): StubMathPlugin {
  return {
    name: `katex`,
    type: `math`,
    remarkPlugin: () => {},
    rehypePlugin: () => {},
    getStyles: () => ``,
  }
}

export const math = createMathPlugin()
export type MathPlugin = StubMathPlugin
export type MathPluginOptions = Record<string, unknown>
