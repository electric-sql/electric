import {
  forwardRef,
  type AnchorHTMLAttributes,
  type CSSProperties,
} from 'react'
import styles from './Link.module.css'

export type LinkSize = 1 | 2 | 3

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  size?: LinkSize
  className?: string
  style?: CSSProperties
}

/**
 * Anchor primitive — replaces `<Link>` from `@radix-ui/themes`.
 *
 * Always renders an `<a>`; visual size matches the Text scale.
 */
export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { size = 2, className, ...rest },
  ref
) {
  const cls = [styles.link, styles[`size${size}`], className]
    .filter(Boolean)
    .join(` `)
  return <a ref={ref} className={cls} {...rest} />
})
