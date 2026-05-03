import {
  forwardRef,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from 'react'
import styles from './Box.module.css'

export type Spacing = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

type BoxOwnProps = {
  as?: ElementType
  className?: string
  style?: CSSProperties
  children?: ReactNode
  /** All-sides padding (matches design tokens 1..9 → --ds-space-*) */
  p?: Spacing
  /** Horizontal padding */
  px?: Spacing
  /** Vertical padding */
  py?: Spacing
  /** Sets `flex-grow: 1` for use inside flex containers. */
  grow?: boolean
}

type BoxProps = BoxOwnProps &
  Omit<React.HTMLAttributes<HTMLElement>, keyof BoxOwnProps>

const PAD_CLASS = (s: Spacing | undefined, prefix: string): string | null => {
  if (s === undefined || s === 0) return null
  return styles[`${prefix}${s}`] ?? null
}

/**
 * Generic layout primitive.
 *
 * Replaces `<Box>` / `<div style={…}>` patterns from `@radix-ui/themes`.
 * Padding/margin props use the design-token spacing scale (1=4px … 9=64px).
 * Renders a `<div>` by default; pass `as` to change the tag.
 */
export const Box = forwardRef<HTMLElement, BoxProps>(function Box(
  { as: Component = `div`, className, style, p, px, py, grow, ...rest },
  ref
) {
  const cls = [
    styles.box,
    grow ? styles.grow : null,
    PAD_CLASS(p, `p`),
    PAD_CLASS(px, `px`),
    PAD_CLASS(py, `py`),
    className,
  ]
    .filter(Boolean)
    .join(` `)
  return <Component ref={ref} className={cls} style={style} {...rest} />
})
