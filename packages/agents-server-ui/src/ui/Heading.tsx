import {
  forwardRef,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from 'react'
import styles from './Heading.module.css'

export type HeadingSize = 1 | 2 | 3 | 4 | 5

type HeadingOwnProps = {
  as?: ElementType
  size?: HeadingSize
  className?: string
  style?: CSSProperties
  children?: ReactNode
}

type HeadingProps = HeadingOwnProps &
  Omit<React.HTMLAttributes<HTMLElement>, keyof HeadingOwnProps>

/**
 * Heading primitive — replaces `<Heading>` from `@radix-ui/themes`.
 *
 * `size` selects from the heading scale (1=base/16px → 5=3xl/30px).
 * Renders an `<h2>` by default; pass `as` to override the tag without
 * changing the visual size.
 */
export const Heading = forwardRef<HTMLElement, HeadingProps>(function Heading(
  { as: Component = `h2`, size = 3, className, style, ...rest },
  ref
) {
  const cls = [styles.heading, styles[`size${size}`], className]
    .filter(Boolean)
    .join(` `)
  return <Component ref={ref} className={cls} style={style} {...rest} />
})
