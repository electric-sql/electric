import {
  forwardRef,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from 'react'
import styles from './Text.module.css'

export type TextSize = 1 | 2 | 3 | 4 | 5 | 6 | 7
export type TextWeight = `regular` | `medium` | `bold`
export type TextTone =
  | `default`
  | `muted`
  | `subtle`
  | `accent`
  | `danger`
  | `success`
  | `warning`
  | `info`
export type TextFamily = `body` | `mono` | `heading`
export type TextAlign = `start` | `center` | `end`

type TextOwnProps = {
  as?: ElementType
  /** Visual size, 1 = xs (12px) … 7 = 3xl (30px). Default 3 (16px). */
  size?: TextSize
  weight?: TextWeight
  tone?: TextTone
  family?: TextFamily
  align?: TextAlign
  truncate?: boolean
  className?: string
  style?: CSSProperties
  children?: ReactNode
  title?: string
}

type TextProps = TextOwnProps &
  Omit<React.HTMLAttributes<HTMLElement>, keyof TextOwnProps>

/**
 * Body-text primitive — replaces `<Text>` from `@radix-ui/themes`.
 *
 * `size`, `weight`, `tone` map to the design-token type/colour scales.
 * `family="mono"` switches to the monospace stack. `truncate` clips with
 * single-line ellipsis.
 *
 * Renders a `<span>` by default; pass `as` for `<p>` / `<div>` / etc.
 */
export const Text = forwardRef<HTMLElement, TextProps>(function Text(
  {
    as: Component = `span`,
    size = 3,
    weight,
    tone,
    family,
    align,
    truncate,
    className,
    style,
    ...rest
  },
  ref
) {
  const cls = [
    styles.text,
    styles[`size${size}`],
    weight ? styles[`weight-${weight}`] : null,
    tone ? styles[`tone-${tone}`] : null,
    family === `mono`
      ? styles[`family-mono`]
      : family === `heading`
        ? styles[`family-heading`]
        : null,
    align ? styles[`align-${align}`] : null,
    truncate ? styles.truncate : null,
    className,
  ]
    .filter(Boolean)
    .join(` `)
  return <Component ref={ref} className={cls} style={style} {...rest} />
})
