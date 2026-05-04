import { forwardRef, type CSSProperties, type ReactNode } from 'react'
import styles from './Badge.module.css'

export type BadgeSize = 1 | 2 | 3
export type BadgeVariant = `soft` | `solid` | `outline`
export type BadgeTone =
  | `neutral`
  | `accent`
  | `danger`
  | `success`
  | `warning`
  | `info`
  | `yellow`

interface BadgeProps {
  size?: BadgeSize
  variant?: BadgeVariant
  tone?: BadgeTone
  className?: string
  style?: CSSProperties
  children?: ReactNode
  title?: string
}

/**
 * Status pill — replaces `<Badge>` from `@radix-ui/themes`.
 *
 * `tone` selects the colour family and `variant` picks the fill style.
 * Replaces `color="red|green|amber|blue|yellow|gray"` from Radix Themes
 * with semantic tone names (danger/success/warning/info/yellow/neutral).
 */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { size = 2, variant = `soft`, tone = `neutral`, className, style, ...rest },
  ref
) {
  const cls = [
    styles.badge,
    styles[`size${size}`],
    styles[`variant-${variant}`],
    styles[`tone-${tone}`],
    className,
  ]
    .filter(Boolean)
    .join(` `)
  return <span ref={ref} className={cls} style={style} {...rest} />
})
