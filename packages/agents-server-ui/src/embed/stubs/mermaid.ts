/**
 * Mobile-embed stub for `mermaid`.
 *
 * The real mermaid bundle is ~5 MB after tree-shake — the largest
 * single dependency in the desktop chat embed. Mobile sessions
 * deliberately don't render diagrams; the `MarkdownCodeBlock`
 * mermaid path catches errors and renders a `data-md-mermaid-block-
 * error` placeholder instead, which is what we want here.
 *
 * Aliased in `vite.config.ts` mobile-embed mode so the dynamic
 * `import('mermaid')` in `MarkdownCodeBlock.tsx` resolves to this
 * file at build time.
 */
const mermaid = {
  initialize: () => {},
  render: async (): Promise<never> => {
    throw new Error(`Mermaid diagrams aren't bundled in the mobile embed.`)
  },
}

export default mermaid
