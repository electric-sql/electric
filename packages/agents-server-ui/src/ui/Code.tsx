import {
  forwardRef,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from 'react'
import styles from './Code.module.css'

export type CodeSize = 1 | 2 | 3
export type CodeVariant = `soft` | `ghost`
export type CodeTone =
  | `default`
  | `accent`
  | `danger`
  | `success`
  | `warning`
  | `muted`

type CodeOwnProps = {
  as?: ElementType
  size?: CodeSize
  /** soft = subtle filled background; ghost = no background */
  variant?: CodeVariant
  tone?: CodeTone
  truncate?: boolean
  className?: string
  style?: CSSProperties
  children?: ReactNode
  title?: string
}

type CodeProps = CodeOwnProps &
  Omit<React.HTMLAttributes<HTMLElement>, keyof CodeOwnProps>

/**
 * Inline code primitive — replaces `<Code>` from `@radix-ui/themes`.
 *
 * `variant="soft"` (default) renders a subtle filled chip; `"ghost"` is
 * just monospace text with no background. Use `tone` for status colours.
 */
export const Code = forwardRef<HTMLElement, CodeProps>(function Code(
  {
    as: Component = `code`,
    size = 2,
    variant = `soft`,
    tone,
    truncate,
    className,
    style,
    ...rest
  },
  ref
) {
  const cls = [
    styles.code,
    styles[`size${size}`],
    styles[`variant-${variant}`],
    tone ? styles[`tone-${tone}`] : null,
    truncate ? styles.truncate : null,
    className,
  ]
    .filter(Boolean)
    .join(` `)
  return <Component ref={ref} className={cls} style={style} {...rest} />
})
