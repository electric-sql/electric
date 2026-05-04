// Streamdown threads its rehype `Element` through every component
// override as a `node` prop. Strip it from the rest spread so React
// doesn't warn about unknown DOM attributes on `<img>`.
type ImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  node?: unknown
}

/**
 * Custom `img` renderer used as a Streamdown `components.img`
 * override.
 *
 * Streamdown's default `img` slot is the entire image-block
 * structure: an outer `<div data-streamdown="image-wrapper">` with
 * a hover overlay and a floating download button, all decorated
 * with inert Tailwind utility classes (`group relative my-4
 * inline-block` + Tailwind's `bg-black/10 group-hover:block` etc.
 * for the overlay). With Tailwind not loaded those classes are
 * dead, so we end up with a bare half-styled wrapper and an
 * unstyled download button.
 *
 * Replacing the slot wholesale is the cleanest fix: render just
 * the `<img>` itself and let `markdown.css` style it. The inline
 * markdown image flows naturally inside its parent paragraph (or
 * sits as a block on its own line, depending on the source).
 */
export function MarkdownImage({
  node: _node,
  alt,
  ...rest
}: ImageProps): React.ReactElement {
  return <img alt={alt ?? ``} loading="lazy" decoding="async" {...rest} />
}
