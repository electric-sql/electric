import type { ReactElement, HTMLAttributes } from 'react'

type CodeProps = HTMLAttributes<HTMLElement> & {
  node?: unknown
  [`data-block`]?: string | boolean
}

/**
 * Expo DOM Components resolve `.web.tsx` before `.tsx`.
 *
 * Keep the mobile DOM bundle single-file by avoiding the desktop
 * code-block renderer's lazy Mermaid import and Shiki/KaTeX paths.
 * Plain fenced code is acceptable on mobile for now and matches the
 * existing Vite mobile-embed stubs.
 */
export function MarkdownCodeBlock({
  children,
  className,
  node: _node,
  'data-block': dataBlock,
  ...rest
}: CodeProps): ReactElement {
  if (dataBlock === undefined) {
    return (
      <code data-md-inline-code="" className={className} {...rest}>
        {children}
      </code>
    )
  }

  return (
    <pre data-md-code-block="">
      <code className={className} {...rest}>
        {children}
      </code>
    </pre>
  )
}
