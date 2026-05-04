import { useCallback, type MouseEvent } from 'react'

// Streamdown threads its rehype `Element` through every component
// override as a `node` prop. Strip it from the rest spread so React
// doesn't warn about an unknown DOM attribute on `<a>`.
type AnchorProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  node?: unknown
}

/**
 * Custom `a` renderer used as a Streamdown `components.a` override.
 *
 * The only behavioural change vs. a plain `<a>` is for in-page
 * fragment links (`href="#id"`): we intercept the click and call
 * `scrollIntoView` on the target ourselves. Two reasons:
 *
 *  1. The app uses `createHashHistory` (see `router.tsx`), so the
 *     URL is `…#/some/route`. Letting the browser handle a
 *     `<a href="#fnref-1">` click would tack a second `#fnref-1`
 *     onto the URL and our hash router would treat it as a route
 *     navigation, blanking the page instead of scrolling.
 *
 *  2. The chat is rendered inside a custom virtual scroll container.
 *     Even without (1) the browser's default anchor jump can fail
 *     to scroll inside non-document-default scrollers; calling
 *     `scrollIntoView` on the target element directly is the
 *     reliable path.
 *
 * `id` lookup falls back to the `user-content-…`-prefixed variant
 * because rehype-sanitize prefixes element IDs by default but
 * (depending on Streamdown's pipeline) may or may not rewrite the
 * matching `href` to use the same prefix. Trying the unprefixed
 * fragment first and the prefixed fragment second covers both.
 *
 * Everything else (external links, mailto:, etc.) is left to the
 * browser's default behaviour.
 */
export function MarkdownAnchor({
  node: _node,
  href,
  onClick,
  children,
  ...rest
}: AnchorProps): React.ReactElement {
  const handleClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event)
      if (event.defaultPrevented) return
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }
      if (!href || !href.startsWith(`#`) || href.length < 2) return

      const fragment = href.slice(1)
      const target =
        document.getElementById(fragment) ??
        document.getElementById(`user-content-${fragment}`)
      if (!target) return

      event.preventDefault()
      target.scrollIntoView({ behavior: `smooth`, block: `center` })
    },
    [href, onClick]
  )

  return (
    <a href={href} onClick={handleClick} {...rest}>
      {children}
    </a>
  )
}
